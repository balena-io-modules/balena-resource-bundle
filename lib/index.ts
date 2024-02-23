import * as tar from 'tar-stream';
import * as stream from 'node:stream';

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
		const promise = new Promise<void>((resolve, reject) => {
			const path = 'resources/' + name;
			const entryStream = this.pack.entry(
				{ name: path, size: size },
				function (err) {
					if (err == null) {
						resolve();
					} else {
						reject(err);
					}
				},
			);

			stream.pipeline(resourceStream, entryStream, (err) => {
				if (err) {
					reject(err);
				}
			});
		});

		this.resourcePromises.push(promise);

		return promise;
	}

	async finalize() {
		this.pack.finalize();

		if (this.packError != null) {
			throw this.packError;
		}

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

		stream.pipeline(input, extract, (err) => {
			// TODO: Figure out more details about this callback
			if (err) {
				throw err;
			}
		});

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
			if (result.done) {
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
