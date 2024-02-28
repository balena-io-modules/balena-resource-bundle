import * as tar from 'tar-stream';
import * as stream from 'node:stream';

const CURRENT_BUNDLE_VERSION = '1';
const CONTENTS_JSON = 'contents.json';

/*
  "resources": [
    {
	  "id": "registry2.balena-cloud.com/v2/cafebabe",
      "path": "image0.tar.gz",
	  "size": 100,
      "digest": "sha256:deadbeef"
    },
    {
	  "id": "registry2.balena-cloud.com/v2/caf3babe",
      "path": "image1.tar.gz",
      "size": 200,
      "digest": "sha256:deadbeef"
    }
  ]
*/
interface Resource {
	id: string;
	path: string;
	size: number;
	digest: string;
}

type CreateOptions = {
	type: string;
	manifest: any;
	resources: Resource[];
};

function toPrettyJSON(obj: any): string {
	// Convert contents to pretty JSON with appended new line
	return JSON.stringify(obj, null, 2) + '\n';
}

class WritableBundle {
	pack: tar.Pack;
	packError: Error | undefined;
	resources: Resource[];
	resourcePromises: Array<Promise<void>>;

	constructor(type: string, manifest: any, resources: Resource[]) {
		const pack = tar.pack();

		const contents = {
			version: CURRENT_BUNDLE_VERSION,
			type: type,
			manifest: manifest,
			resources: resources,
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
	}

	async addResource(id: string, data: stream.Readable): Promise<void> {
		const resource = this.resources.find((res) => res.id === id);

		// TODO: Add test for unknown resource ID
		if (resource == null) {
			throw new Error(`Unknown resource ${id}`);
		}

		const { size, path } = resource;

		const promise = new Promise<void>((resolve, reject) => {
			const name = 'resources/' + path;
			const entry = this.pack.entry({ name, size }, function (err) {
				if (err == null) {
					resolve();
				} else {
					reject(err);
				}
			});

			// TODO: validate checksum of data
			stream.pipeline(data, entry, (err) => {
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
	return new WritableBundle(options.type, options.manifest, options.resources);
}

class ReadableBundle {
	extract: tar.Extract;
	type: string;
	contents: any | undefined;
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

	private async parseContents(entry: tar.Entry) {
		// TODO: add a test for already parsed contents.json
		if (this.contents != null) {
			throw new Error(`${CONTENTS_JSON} is already parsed`);
		}

		// TODO: validate this is indeed contents.json and add test for this

		// TODO: extract converting stream to json into separate function
		// TODO: see what this does more specifically with the debugger
		const contents = await new Response(entry as any).json();

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
			const requiredResourceKeys = ['id', 'path', 'size', 'digest'];
			for (const key of requiredResourceKeys) {
				if (!(key in resource)) {
					throw new Error(
						`Missing "${key}" in "resources" of ${CONTENTS_JSON}`,
					);
				}
			}
		}

		this.contents = contents;
	}

	async manifest(): Promise<any> {
		if (this.contents != null) {
			return this.contents.manifest;
		}

		const result = await this.iterator.next();

		const entry = result.value;

		await this.parseContents(entry);

		return this.contents.manifest;
	}

	async *resources() {
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
			if (path === CONTENTS_JSON) {
				throw new Error('Manifest is not yet accessed');
			}

			// TODO: skip or error out on other items that are not resources
			// TODO: the user needs to access the resources descriptors as well
			yield value;
		}
	}
}

export function open(input: stream.Readable, type: string): ReadableBundle {
	return new ReadableBundle(input, type);
}
