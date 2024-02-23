import * as tar from 'tar-stream';
import type * as stream from 'node:stream';

type CreateOptions = {
	type: string;
	manifest: any;
};

function toPrettyJSON(obj: any): string {
	// Convert contents to pretty JSON with appended
	// new line at the end
	return JSON.stringify(obj, null, 2) + '\n';
}

class WritableBundle {
	pack: tar.Pack;
	resourcePromises: Array<Promise<void>>;
	packError: Error | undefined;

	constructor(type: string, manifest: any) {
		const pack = tar.pack();

		const contents = {
			version: 1,
			type: type,
			manifest: manifest,
		};

		const json = toPrettyJSON(contents);

		pack.entry({ name: 'contents.json' }, json);

		pack.on('error', (err) => {
			this.packError = err;
		});

		this.pack = pack;
		this.resourcePromises = [];
	}

	async addResource(
		name: string,
		size: number,
		resourceStream: stream.Readable,
	): Promise<void> {
		let streamFinished: any;
		let streamFailed: any;
		const promise = new Promise<void>((resolve, reject) => {
			streamFinished = resolve;
			streamFailed = reject;
		});
		this.resourcePromises.push(promise);

		const path = 'resources/' + name;
		const entryStream = this.pack.entry(
			{ name: path, size: size },
			function (err) {
				if (err == null) {
					streamFinished();
				} else {
					streamFailed(err);
				}
			},
		);

		resourceStream.on('error', (err) => streamFailed(err));
		entryStream.on('error', (err) => streamFailed(err));

		// TODO: Investigate `pipeline` as replacement, what NodeJS version
		// and what the exact differences are - especially error handling and
		// how it deals with stream handling
		resourceStream.pipe(entryStream);

		return promise;
	}

	async finalize() {
		if (this.packError != null) {
			throw this.packError;
		}

		this.pack.finalize();

		await Promise.all(this.resourcePromises);
	}
}

export function create(options: CreateOptions): WritableBundle {
	return new WritableBundle(options.type, options.manifest);
}

class ReadableBundle {
	extract: tar.Extract;
	contents: any | undefined;
	iterator: AsyncIterator<tar.Entry, any, undefined>;

	constructor(input: stream.Readable) {
		const extract = tar.extract();

		input.pipe(extract);

		this.extract = extract;
		this.iterator = extract[Symbol.asyncIterator]();
	}

	async manifest(): Promise<any> {
		if (this.contents != null) {
			return this.contents.manifest;
		}

		const result = await this.iterator.next();

		const entry = result.value;

		const contents = await new Response(entry).json();

		this.contents = contents;

		return contents.manifest;
	}

	async *resources() {
		while (true) {
			const result = await this.iterator.next();
			if (result.done === true) {
				break;
			}
			// TODO: add check whether this is a resource
			yield result.value;
		}
	}
}

export function open(input: stream.Readable): ReadableBundle {
	return new ReadableBundle(input);
}
