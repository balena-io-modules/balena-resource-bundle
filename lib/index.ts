import * as tar from 'tar-stream';
import type * as stream from 'node:stream';

type CreateOptions = {
	type: string;
	manifest: any;
};

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

		// TODO: Check for a better way to serialize a pretty json
		const json = JSON.stringify(contents, null, 2) + '\n';

		pack.entry({ name: 'contents.json' }, json);

		pack.on('error', (err) => {
			this.packError = err;
		});

		this.pack = pack;
		this.resourcePromises = [];
	}

	// TODO: tar-stream's entry method handles `string | Buffer`
	async addResource(
		name: string,
		size: number,
		resourceStream: stream.Readable,
	): Promise<void> {
		const path = 'resources/' + name;
		let streamFinished: any;
		let streamFailed: any;
		const promise = new Promise<void>((resolve, reject) => {
			streamFinished = resolve;
			streamFailed = reject;
		});
		this.resourcePromises.push(promise);

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
	_manifest?: Promise<any>; // to keep here the actual manifest
	_iterator: AsyncIterator<tar.Entry, any, undefined>;

	constructor(input: stream.Readable) {
		const extract = tar.extract();

		input.pipe(extract);

		this.extract = extract;
		this._iterator = extract[Symbol.asyncIterator]();
	}

	async manifest(): Promise<any> {
		// TODO: We have to store manifest in this
		// so that we do not pull from stream each time

		const result = await this._iterator.next();

		const entry = result.value;

		// TODO: make sure using `Response` here is alright
		// let json = await stringStream(entry)
		// let contents = JSON.parse(entry)
		const contents = await new Response(entry).json();

		return contents.manifest;
	}

	async *resources() {
		while (true) {
			const result = await this._iterator.next();
			if (result.done === true) {
				break;
			}
			// TODO: add check whether this is a resource
			yield result.value;
		}
	}
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function open(input: stream.Readable, _type: string): ReadableBundle {
	return new ReadableBundle(input);
}
