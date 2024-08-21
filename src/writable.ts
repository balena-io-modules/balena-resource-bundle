import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type {
	BundleDescription,
	Envelope,
	Resource,
	Signature,
	WritableResource,
} from './types';
import {
	CURRENT_BUNDLE_VERSION,
	CONTENTS_JSON,
	CONTENTS_SIG,
	RESOURCES_DIR,
} from './constants';
import * as signer from './signer';
import { toPrettyJSON, describeResource } from './utils';

export interface SignOptions {
	privateKey: string;
}

export interface CreateOptions {
	sign?: SignOptions;
}

export function create<T>(
	description: BundleDescription<T, WritableResource>,
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
	const envelope: Envelope<T> = {
		schemaVersion: CURRENT_BUNDLE_VERSION,
		contents: {
			type: description.type,
			manifest: description.manifest,
			resources: description.resources.map(describeResource),
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
	scheduleResources(pack, description.resources.values(), (err) => {
		if (err != null) {
			pack.destroy(err);
		} else {
			pack.finalize();
		}
	});

	return out;
}

function scheduleResources(
	pack: tar.Pack,
	iter: Iterator<WritableResource>,
	cb: (err?: Error) => void,
) {
	const result = iter.next();
	if (result.done) {
		cb();
		return;
	}
	const resource = result.value;

	function next(err?: Error) {
		if (err != null) {
			cb(err);
		} else {
			setImmediate(() => scheduleResources(pack, iter, cb));
		}
	}

	if (resource.data instanceof stream.Readable) {
		packEntry(pack, resource, resource.data, next);
	} else if (typeof resource.data === 'function') {
		packPromise(pack, resource, resource.data, next);
	} else {
		next(new Error(`Invalid data for resource with ID '${resource.id}'`));
	}
}

function packEntry(
	pack: tar.Pack,
	resource: Resource,
	data: stream.Readable,
	next: (err?: Error) => void,
) {
	const name = `${RESOURCES_DIR}/` + sha256sum(resource.id);
	const hasher = new Hasher(resource.digest);
	const entry = pack.entry({ name, size: resource.size });

	entry.on('error', next);

	stream.pipeline(data, hasher, entry, (err) => {
		if (err != null) {
			next(err);
		} else {
			next();
		}
	});
}

function packPromise(
	pack: tar.Pack,
	resource: Resource,
	deferred: (resource: Resource) => Promise<stream.Readable>,
	next: (err?: Error) => void,
) {
	try {
		Promise.resolve(deferred(resource)).then(
			(data) => packEntry(pack, resource, data, next),
			next,
		);
	} catch (err) {
		next(err);
		return;
	}
}
