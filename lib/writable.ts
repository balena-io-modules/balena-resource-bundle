import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import Hasher from './hasher';
import type { Contents, Resource } from './contents';
import {
	CURRENT_BUNDLE_VERSION,
	CONTENTS_JSON,
	RESOURCES_DIR,
} from './contents';

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
