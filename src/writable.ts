import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type { Contents, Resource, Signature } from './types';
import {
	CURRENT_BUNDLE_VERSION,
	CONTENTS_JSON,
	CONTENTS_SIG,
	RESOURCES_DIR,
} from './constants';
import * as signer from './signer';
import { toPrettyJSON, getResourceDescriptor } from './utils';

export interface SignOptions {
	privateKey: string;
}

export interface WritableBundleOptions<T> {
	type: string;
	manifest: T;
	sign?: SignOptions;
}

export class WritableBundle<T> {
	private options: WritableBundleOptions<T>;
	private resources: Resource[];

	public constructor(options: WritableBundleOptions<T>) {
		this.options = options;
		this.resources = [];
	}

	public addResource(resource: Resource) {
		if (this.resources.some((p) => p.id === resource.id)) {
			throw new Error(
				`A resource with ID "${resource.id}" has already been added`,
			);
		}
		this.resources.push(resource);
	}

	public finalize(): stream.Readable {
		const out = new stream.PassThrough();

		const pack = tar.pack();
		pack.on('error', (err) => {
			if (err != null) {
				out.emit('error', err);
			}
		});

		// Add contents.json
		const contents: Contents<T> = {
			version: CURRENT_BUNDLE_VERSION,
			type: this.options.type,
			manifest: this.options.manifest,
			resources: this.resources.map(getResourceDescriptor),
		};

		const contentsJson = toPrettyJSON(contents);
		pack.entry({ name: CONTENTS_JSON }, contentsJson);

		// Add contents.sig
		const contentsSig: Signature = { digest: sha256sum(contentsJson) };
		if (this.options.sign != null) {
			contentsSig.signature = signer.sign(
				this.options.sign.privateKey,
				contentsJson,
			);
		}

		const contentsSigJson = toPrettyJSON(contentsSig);
		pack.entry({ name: CONTENTS_SIG }, contentsSigJson);

		// Add resources/
		for (const resource of this.resources) {
			const name = `${RESOURCES_DIR}/` + sha256sum(resource.id);
			const entry = pack.entry({ name, size: resource.size });
			const hasher = new Hasher(resource.digest);
			stream.pipeline(resource.data, hasher, entry, (err) => {
				if (err != null) {
					out.emit('error', err);
				}
			});
		}

		pack.finalize();

		stream.pipeline(pack, out, (err) => {
			if (err != null) {
				out.emit('error', err);
			}
		});

		return out;
	}
}

export type CreateOptions<T> = WritableBundleOptions<T> & {
	resources: Resource[];
};

export function create<T>(options: CreateOptions<T>): stream.Readable {
	const bundle = new WritableBundle(options);
	for (const resource of options.resources) {
		bundle.addResource(resource);
	}
	return bundle.finalize();
}
