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

export function toPrettyJSON(obj: any): string {
	// Convert contents to pretty JSON
	return JSON.stringify(obj, null, 2);
}

export class WritableBundle<T> {
	private pack: tar.Pack | null;
	private resources: Resource[];
	private packError: Error | undefined;
	private lastResourcePromise: Promise<void> | undefined;
	private addedResources: Set<string>;

	constructor(
		type: string,
		manifest: T,
		resources: Resource[],
		signOptions?: SignOptions,
	) {
		const resourceIds = resources.map(({ id }) => id);
		const uniqueIds = new Set(resourceIds);
		if (resourceIds.length !== uniqueIds.size) {
			const duplicateIds = resourceIds.filter((id) => !uniqueIds.delete(id));
			throw new Error(
				`Duplicate resource IDs are not allowed: ${duplicateIds}`,
			);
		}

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
		this.addedResources = new Set();
	}

	public async addResource(id: string, data: stream.Readable) {
		const resource = this.resources.find((res) => res.id === id);

		if (resource == null) {
			throw new Error(`Adding unknown resource "${id}"`);
		}

		const { size, digest } = resource;

		const hasher = new Hasher(digest);

		// Manually enforce one stream at a time in the tar stream
		await this.lastResourcePromise;

		const promise = new Promise<void>((resolve, reject) => {
			if (this.pack == null) {
				throw new Error('This bundle has already been finalized');
			}

			if (this.addedResources.has(id)) {
				throw new Error(`Resource "${id}" is already added`);
			}

			const name = `${RESOURCES_DIR}/` + sha256sum(id);
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

		this.lastResourcePromise = promise;

		this.addedResources.add(id);

		try {
			await promise;
		} catch (err) {
			this.addedResources.delete(id);
			throw err;
		}
	}

	private get pendingResources(): Resource[] {
		return this.resources.filter(({ id }) => !this.addedResources.has(id));
	}

	public async finalize() {
		if (this.pack == null) {
			throw new Error('This bundle has already been finalized');
		}

		await this.lastResourcePromise;

		const pendingResources = this.pendingResources;

		if (pendingResources.length > 0) {
			throw new Error(
				`Missing resources: ${pendingResources.map(({ id }) => id).join(', ')}`,
			);
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
