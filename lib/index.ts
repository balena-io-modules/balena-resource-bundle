import * as tar from 'tar-stream';
import * as stream from 'node:stream';

// TODO: Switch to nvm and NodeJS 20

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

		// TODO: Should add "resources" here!
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
	type: string;
	contents: any | undefined;
	iterator: AsyncIterator<tar.Entry, any, undefined>;

	constructor(input: stream.Readable, type: string) {
		const extract = tar.extract();

		// TODO: Possibly move this `pipeline` call to `manifest`
		stream.pipeline(input, extract, (err) => {
			// TODO: Figure out more details about this callback
			if (err) {
				throw err;
			}
		});

		this.type = type;
		this.extract = extract;
		this.iterator = extract[Symbol.asyncIterator]();
	}

	get manifest(): Promise<any> {
		return (async () => {
			if (this.contents != null) {
				return this.contents.manifest;
			}

			const result = await this.iterator.next();

			const entry = result.value;

			// TODO: extract converting stream to json into separate function
			// TODO: see what this does more specifically with the debugger
			const contents = await new Response(entry).json();

			// TODO: add all validation needed on top of the contents.json
			// TODO: extract validation in separate function
			if (!('version' in contents)) {
				throw new Error('Missing "version" in contents.json');
			}

			if (!('type' in contents)) {
				throw new Error('Missing "type" in contents.json');
			}

			if (!('manifest' in contents)) {
				throw new Error('Missing "manifest" in contents.json');
			}

			if (contents.type !== this.type) {
				throw new Error(
					`Expected type (${this.type}) does not match received type (${contents.type})`,
				);
			}

			this.contents = contents;

			return contents.manifest;
		})();
	}

	async *readResources() {
		// TODO: we can also possibly read contents.json here
		// if we allow an API that does not require calling
		// manifest at all.
		while (true) {
			const result = await this.iterator.next();
			if (result.done) {
				break;
			}

			const value = result.value;

			const path = value.header.name;
			if (path === 'contents.json') {
				throw new Error('Manifest is not yet accessed');
			}

			// TODO: skip or error out on other items that are not resources
			yield value;
		}
	}
}

export function open(input: stream.Readable, type: string): ReadableBundle {
	return new ReadableBundle(input, type);
}
