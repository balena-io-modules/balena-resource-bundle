import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type { BundleDescription, Envelope, Signature } from './types';
import {
	CURRENT_BUNDLE_VERSION,
	CONTENTS_JSON,
	CONTENTS_SIG,
	RESOURCES_DIR,
} from './constants';
import * as signer from './signer';
import {
	describeResource,
	mapResources,
	scheduleResources,
	toPrettyJSON,
} from './utils';

export interface SignOptions {
	privateKey: string;
}

export interface CreateOptions {
	sign?: SignOptions;
}

export function create<ManifestType>(
	description: BundleDescription<ManifestType>,
	options: CreateOptions | undefined = {},
): stream.Readable {
	const resourceIds = description.resources.map(({ id }) => id);
	const uniqueIds = new Set(resourceIds);
	if (resourceIds.length !== uniqueIds.size) {
		const duplicateIds = resourceIds.filter((id) => !uniqueIds.delete(id));
		throw new Error(`Found duplicate resource IDs: ${duplicateIds}`);
	}

	const pack = tar.pack();
	const out = new stream.PassThrough();
	stream.pipeline(pack, out, () => {
		// noop
	});

	// Add contents.json
	const envelope: Envelope<ManifestType> = {
		schemaVersion: CURRENT_BUNDLE_VERSION,
		contents: {
			type: description.type,
			manifest: description.manifest,
			resources: mapResources(description.resources, (resource) => ({
				// this dance is to ensure we don't include a data stream
				// into the serialized contents.json
				...describeResource(resource),
				size: resource.size,
				digest: resource.digest,
			})),
		},
	};

	const contentsJson = toPrettyJSON(envelope);
	pack.entry({ name: CONTENTS_JSON }, contentsJson);

	// Add contents.sig
	const contentsSig: Signature = { digest: sha256sum(contentsJson) };
	if (options.sign != null) {
		contentsSig.signature = signer.sign(options.sign.privateKey, contentsJson);
	}

	const contentsSigJson = toPrettyJSON(contentsSig);
	pack.entry({ name: CONTENTS_SIG }, contentsSigJson);

	// Add resources/
	scheduleResources(
		description.resources.values(),
		(resource, data, next) => {
			const name = `${RESOURCES_DIR}/` + sha256sum(resource.id);

			data.on('error', next);

			let hasher;
			try {
				// may throw synchronously if digest is malform or unsupported algo
				hasher = new Hasher(resource.digest);
			} catch (err) {
				data.destroy(err);
				return;
			}
			hasher.on('error', next);

			const entry = pack.entry({ name, size: resource.size });
			entry.on('error', next);

			stream.pipeline(data, hasher, entry, (err) => {
				if (err != null) {
					next(err);
				} else {
					next();
				}
			});
		},
		(err) => {
			if (err != null) {
				pack.destroy(err);
			} else {
				pack.finalize();
			}
		},
	);

	return out;
}
