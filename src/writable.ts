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
	private pack: tar.Pack | null;
	private resources: Resource[];
	private packError: Error | undefined;
	private addedChecksums: string[];
	private inProgress: boolean;
	private addedResources: Set<string>;

	constructor(
		type: string,
		manifest: T,
		resources: Resource[],
		signOptions?: SignOptions,
	) {
		const pack = tar.pack();

		pack.on('error', (err) => {
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
		this.addedChecksums = [];
		this.addedResources = new Set();
		this.inProgress = false;
	}

	public async addResource(
		id: string,
		data: stream.Readable,
	): Promise<boolean> {
		if (this.inProgress) {
			throw new Error('Current resource stream is still in progress');
		}

		this.inProgress = true;

		const resource = this.resources.find((res) => res.id === id);

		if (resource == null) {
			throw new Error(`Adding unknown resource "${id}"`);
		}

		const { size, digest } = resource;

		const hasher = new Hasher(digest);

		if (this.addedChecksums.includes(hasher.checksum)) {
			// We have not consumed the stream here - it is up to him to do that.
			this.addedResources.add(id);
			this.inProgress = false;
			return false;
		} else {
			this.addedChecksums.push(hasher.checksum);
		}

		const promise = new Promise<void>((resolve, reject) => {
			if (this.pack == null) {
				throw new Error('This bundle has already been finalized');
			}

			const name = `${RESOURCES_DIR}/` + hasher.checksum;
			const entry = this.pack.entry({ name, size }, function (err) {
				if (err) {
					reject(err);
				}
			});

			stream.pipeline(data, hasher, entry, (err) => {
				this.inProgress = false;

				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});

		this.addedResources.add(id);

		try {
			await promise;
		} catch(err) {
			this.addedResources.delete(id);
			throw err;
		}

		return true;
	}

	public async finalize() {
		if (this.pack == null) {
			throw new Error('This bundle has already been finalized');
		}

		if (this.inProgress) {
			throw new Error(
				'Cannot finalize resource stream while still in progress',
			);
		}

		for (const { id } of this.resources) {
			if (!this.addedResources.has(id)) {
				throw new Error(`Resource "${id}" was not added`);
			}
		}

		this.pack.finalize();

		if (this.packError != null) {
			throw this.packError;
		}

		this.pack = null;
	}

	public get stream(): stream.Readable {
		if (this.pack == null) {
			throw new Error('This bundle has already been finalized');
		}
		return this.pack;
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
