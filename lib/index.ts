import * as tar from 'tar-stream';
import * as stream from 'node:stream';
import * as crypto from 'node:crypto';

const CURRENT_BUNDLE_VERSION = '1';
const CONTENTS_JSON = 'contents.json';
const RESOURCES_DIR = 'resources';

// TODO: Split all functionality in separate modules - readable.ts, etc.

// TODO: After clearing out current todos do another pass to make sure nothing is omitted

// TODO: Tansfer back schema to specification on Fibery
interface Resource {
	id: string;
	size: number;
	digest: string;
	type?: string;
}

interface Contents<T> {
	version: string;
	type: string;
	manifest: T;
	resources: Resource[];
}

type CreateOptions<T> = Omit<Contents<T>, 'version'>;

function toPrettyJSON(obj: any): string {
	// Convert contents to pretty JSON with appended new line
	return JSON.stringify(obj, null, 2) + '\n';
}

class WritableBundle<T> {
	// TODO: Mark fields as private
	pack: tar.Pack;
	packError: Error | undefined;
	resources: Resource[];
	resourcePromises: Array<Promise<void>>;
	addedChecksums: string[];

	constructor(type: string, manifest: T, resources: Resource[]) {
		const pack = tar.pack();

		const contents: Contents<T> = {
			version: CURRENT_BUNDLE_VERSION,
			type,
			manifest,
			resources,
		};

		const json = toPrettyJSON(contents);

		pack.entry({ name: CONTENTS_JSON }, json);

		// TODO: Create the signature of contents.json and insert if afterwards

		pack.on('error', (err) => {
			// TODO: Why do we store packError and keep this error handler here
			// Write a description after finding out
			this.packError = err;
		});

		this.pack = pack;
		this.resources = resources;
		this.resourcePromises = [];
		this.addedChecksums = [];
	}

	async addResource(id: string, data: stream.Readable): Promise<void> {
		const resource = this.resources.find((res) => res.id === id);

		// TODO: Add test for unknown resource ID
		if (resource == null) {
			throw new Error(`Unknown resource ${id}`);
		}

		const { size, digest } = resource;

		const hasher = new Hasher(digest);

		// TODO: Create deduplication test(s) and make sure they

		// TODO: Store checksums only
		if (this.addedChecksums.includes(hasher.checksum)) {
			// TODO: FIGURE out whether to Drain the stream as well!!!
			// FIGURE out to return a boolean if there is duplication, so that
			// the user may close the stream himself
			return Promise.resolve();
		} else {
			this.addedChecksums.push(hasher.checksum);
		}

		const promise = new Promise<void>((resolve, reject) => {
			const name = `${RESOURCES_DIR}/` + hasher.checksum;
			const entry = this.pack.entry({ name, size }, function (err) {
				if (err) {
					reject(err);
				}
			});

			// TODO: Test checksum validation of data
			stream.pipeline(data, hasher, entry, (err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
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

export function create<T>(options: CreateOptions<T>): WritableBundle<T> {
	return new WritableBundle(options.type, options.manifest, options.resources);
}

class ReadableBundle<T> {
	// TODO: Mark fields as private
	extract: tar.Extract;
	type: string;
	contents: Contents<T> | undefined;
	iterator: AsyncIterator<tar.Entry, any, undefined>;

	constructor(input: stream.Readable, type: string) {
		const extract = tar.extract();

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

	private async parseContents(entry: tar.Entry): Promise<Contents<T>> {
		// TODO: Add a test for already parsed contents.json
		if (this.contents != null) {
			throw new Error(`${CONTENTS_JSON} is already parsed`);
		}

		// TODO: Validate this is indeed contents.json and add test for this

		// TODO: Extract converting stream to json into separate function
		// TODO: See what this does more specifically with the debugger
		const contents: Contents<T> = await new Response(entry as any).json();

		// TODO: Make sure we cover all the validation needed for contents.json

		const requiredKeys = ['version', 'type', 'manifest', 'resources'];
		for (const key of requiredKeys) {
			if (!(key in contents)) {
				throw new Error(`Missing "${key}" in ${CONTENTS_JSON}`);
			}
		}

		// TODO: Do version negotiation
		// TODO: Add a test for version mismatch
		if (contents.version !== CURRENT_BUNDLE_VERSION) {
			throw new Error(
				`Unsupported bundle version ${contents.version} (expected ${CURRENT_BUNDLE_VERSION})`,
			);
		}

		if (contents.type !== this.type) {
			throw new Error(
				`Expected type (${this.type}) does not match received type (${contents.type})`,
			);
		}

		for (const resource of contents.resources) {
			const requiredResourceKeys = ['id', 'size', 'digest'];
			for (const key of requiredResourceKeys) {
				if (!(key in resource)) {
					throw new Error(
						`Missing "${key}" in "resources" of ${CONTENTS_JSON}`,
					);
				}
			}
		}

		// TODO: Validate the specific fields of resources contents here
		// This way we will not have to re-validate when we use it
		// TODO: Also add tests for each added validation

		return contents;
	}

	async manifest(): Promise<T> {
		if (this.contents != null) {
			return this.contents.manifest;
		}

		const result = await this.iterator.next();

		const entry = result.value;

		this.contents = await this.parseContents(entry);

		return this.contents.manifest;
	}

	async *resources() {
		if (this.contents == null) {
			throw new Error('Must call `manifest()` before `resources()`');
		}

		while (true) {
			const result = await this.iterator.next();
			if (result.done) {
				break;
			}

			const entry = result.value;

			const path = entry.header.name;

			// TODO: Should we error out when encountering entries that are
			// not resources or we should skip those?

			// TODO: Check node.js path library for splitting this
			// TODO: Validate this split
			const filename = path.split(`${RESOURCES_DIR}/`)[1];

			const descriptors = this.contents.resources.filter(
				// TODO: What happens if this split is broken and how to break it in test?
				(descriptor) => descriptor.digest.split(':')[1] === filename,
			);

			if (descriptors.length === 0) {
				// TODO: Improve error message
				throw new Error('Unknown resource');
			}

			// TODO: Test for duplicated resources
			const hasher = new Hasher(descriptors[0].digest);

			// TODO: Expose accessing resources descriptors stored in contents.json

			stream.pipeline(entry, hasher, (err) => {
				// TODO: How to handle this error?
				// TODO: How to test this.
				if (err) {
					throw err;
				}
			});

			// TODO: Define interface for this return type
			yield {
				resource: hasher,
				descriptors,
			};
		}
	}
}

export function open<T>(
	input: stream.Readable,
	type: string,
): ReadableBundle<T> {
	return new ReadableBundle(input, type);
}

// TODO: Separately test the hasher as well - this may repeat some tests

class Hasher extends stream.PassThrough {
	private _digest: string;
	private _algorithm: string;
	private _checksum: string;

	constructor(digest: string) {
		super();

		// TODO: Validate the parse result
		const [algorithm, checksum] = digest.split(':');
		this._digest = digest;
		this._algorithm = algorithm;
		this._checksum = checksum;

		// TODO: Test with unknown algorithm
		const hash = crypto.createHash(algorithm);

		this.on('data', (chunk) => hash.update(chunk));

		this.on('end', () => {
			const calculatedChecksum = hash.digest('hex');
			// TODO: Add a test for non-matching digest
			if (checksum !== calculatedChecksum) {
				this.emit(
					'error',
					new Error(
						`Expected digest ${digest} does not match calculated digest ${algorithm}:${calculatedChecksum}`,
					),
				);
			}
		});
	}

	get digest(): string {
		return this._digest;
	}

	get algorithm(): string {
		return this._algorithm;
	}

	get checksum(): string {
		return this._checksum;
	}
}
