import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type { BundleDescription, Contents, Signature } from './types';
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

export interface CreateOptions {
	sign?: SignOptions;
}

export function create<T>(
	description: BundleDescription<T>,
	options: CreateOptions | undefined = {},
): stream.Readable {
	const resourceIds = description.resources.map(({ id }) => id);
	const uniqueIds = new Set(resourceIds);
	if (resourceIds.length !== uniqueIds.size) {
		const duplicateIds = resourceIds.filter((id) => !uniqueIds.delete(id));
		throw new Error(`Found duplicate resource IDs: ${duplicateIds}`);
	}

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
		type: description.type,
		manifest: description.manifest,
		resources: description.resources.map(getResourceDescriptor),
	};

	const contentsJson = toPrettyJSON(contents);
	pack.entry({ name: CONTENTS_JSON }, contentsJson);

	// Add contents.sig
	const contentsSig: Signature = { digest: sha256sum(contentsJson) };
	if (options.sign != null) {
		contentsSig.signature = signer.sign(options.sign.privateKey, contentsJson);
	}

	const contentsSigJson = toPrettyJSON(contentsSig);
	pack.entry({ name: CONTENTS_SIG }, contentsSigJson);

	// Add resources/
	for (const resource of description.resources) {
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
