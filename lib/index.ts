import * as tar from 'tar-stream';
import * as stream from 'node:stream';
import * as crypto from 'node:crypto';

const CURRENT_BUNDLE_VERSION = '1';
const CONTENTS_JSON = 'contents.json';
const RESOURCES_DIR = 'resources';

// TODO: Split all functionality in separate modules - readable.ts, etc.

/*
{
  "version": "1",
  "type": "release@4",
  "manifest": {
    // the portion of the API state endpoint that
    // describes a single app.
  },
  "resources": [
    {
	  "id": "registry2.balena-cloud.com/v2/cafebabe",
      "type": "tar.gz",
	  "size": 100,
      "digest": "sha256:deadbeef"
    },
    {
	  "id": "registry2.balena-cloud.com/v2/caf3babe",
      "type": "tar.gz",
      "size": 200,
      "digest": "sha256:deadbeef"
    }
  ]
}
*/
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

		// TODO: This is not validated
		const [algorithm, checksum] = digest.split(':');

		// TODO: Can we test deduplication here?
		if (this.addedChecksums.includes(checksum)) {
			return Promise.resolve();
		}

		const promise = new Promise<void>((resolve, reject) => {
			const hasher = new HashThrough(algorithm);

			const name = `${RESOURCES_DIR}/` + checksum;
			const entry = this.pack.entry({ name, size }, function (err) {
				if (err == null) {
					console.debug(`Expected ${checksum}, received ${hasher.digest}`);
					resolve();
				} else {
					reject(err);
				}
			});

			// TODO: validate checksum of data - check Node.js crypto
			stream.pipeline(data, hasher, entry, (err) => {
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

export function create<T>(options: CreateOptions<T>): WritableBundle<T> {
	return new WritableBundle(options.type, options.manifest, options.resources);
}

class ReadableBundle<T> {
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
		// TODO: add a test for already parsed contents.json
		if (this.contents != null) {
			throw new Error(`${CONTENTS_JSON} is already parsed`);
		}

		// TODO: validate this is indeed contents.json and add test for this

		// TODO: extract converting stream to json into separate function
		// TODO: see what this does more specifically with the debugger
		const contents: Contents<T> = await new Response(entry as any).json();

		// TODO: make sure we cover all the validation needed for contents.json

		const requiredKeys = ['version', 'type', 'manifest', 'resources'];
		for (const key of requiredKeys) {
			if (!(key in contents)) {
				throw new Error(`Missing "${key}" in ${CONTENTS_JSON}`);
			}
		}

		// TODO: Validate resources contents

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

			// TODO: Error on non-resources
			// TODO: check node.js path library for splitting this
			const checksum = path.split(`${RESOURCES_DIR}/`)[1];

			// TODO: Error on missing descriptors
			const descriptors = this.contents.resources.filter(
				(descriptor) => descriptor.digest.split(':')[1] === checksum,
			);

			// TODO: Test for duplicated resources

			// TODO: skip or error out on other items that are not resources
			// TODO: the user needs to access the resources descriptors as well
			// TODO: Define interface for this return type
			yield {
				resource: entry,
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

class HashThrough extends stream.PassThrough {
	hash: crypto.Hash;

	constructor(algorithm: string) {
		super();

		const hash = crypto.createHash(algorithm);

		this.on('data', (chunk) => hash.update(chunk));

		this.hash = hash;
	}

	get digest(): string {
		return this.hash.digest('hex');
	}
}
