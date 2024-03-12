import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type { Contents, Resource, Signature } from './types';
import {
	CURRENT_BUNDLE_VERSION,
	CONTENTS_JSON,
	CONTENTS_SIG,
	RESOURCES_DIR,
} from './types';
import * as signer from './signer';

interface SignOptions {
	privateKey: string;
}

type CreateOptions<T> = Omit<Contents<T>, 'version'> & { sign?: SignOptions };

function toPrettyJSON(obj: any): string {
	// Convert contents to pretty JSON
	return JSON.stringify(obj, null, 2);
}

class WritableBundle<T> {
	pack: tar.Pack;

	private packError: Error | undefined;
	private resources: Resource[];
	private resourcePromises: Array<Promise<void>>;
	private addedChecksums: string[];

	constructor(
		type: string,
		manifest: T,
		resources: Resource[],
		signOptions?: SignOptions,
	) {
		const pack = tar.pack();

		pack.on('error', (err) => {
			// TODO: Why do we store packError and keep this error handler here
			// After finishing all tests comment this out and see if it works without it
			// Write a description after finding out
			this.packError = err;
		});

		const contents: Contents<T> = {
			version: CURRENT_BUNDLE_VERSION,
			type,
			manifest,
			resources,
		};

		const contentsJson = toPrettyJSON(contents);

		pack.entry({ name: CONTENTS_JSON }, contentsJson);

		const contentsSig: Signature = { digest: sha256sum(contentsJson) };
		if (signOptions != null) {
			const { privateKey } = signOptions;
			contentsSig.signature = signer.sign(privateKey, contentsJson);
		}

		const contentsSigJson = toPrettyJSON(contentsSig);

		pack.entry({ name: CONTENTS_SIG }, contentsSigJson);

		this.pack = pack;
		this.resources = resources;
		this.resourcePromises = [];
		this.addedChecksums = [];
	}

	async addResource(id: string, data: stream.Readable): Promise<void> {
		const resource = this.resources.find((res) => res.id === id);

		if (resource == null) {
			throw new Error(`Adding unknown resource "${id}"`);
		}

		const { size, digest } = resource;

		const hasher = new Hasher(digest);

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
	return new WritableBundle(
		options.type,
		options.manifest,
		options.resources,
		options.sign,
	);
}
