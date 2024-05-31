import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type { Contents, Resource } from './types';
import {
	CONTENTS_JSON,
	CONTENTS_SIG,
	CURRENT_BUNDLE_VERSION,
	RESOURCES_DIR,
} from './constants';
import { streamToString } from './utils';
import * as signer from './signer';

function makeEntriesIterator(extract: tar.Extract) {
	type Value = {
		headers: tar.Headers;
		data: stream.Readable;
	};
	type Result = {
		value?: Value;
		done: boolean;
	};
	type Entry = {
		value: Value;
		next: tar.Callback;
	};
	type EntryHandler = (entry: Entry) => void;

	const entries: Entry[] = [];

	let error: Error | undefined;
	let resolve0: ((res: Result) => void) | undefined;
	let reject0: ((err: Error) => void) | undefined;
	let entryHandler: EntryHandler | undefined;

	function tick() {
		// If there are pending entries...
		if (entries.length > 0) {
			// and there's a pending promise...
			if (resolve0 != null) {
				// then someone is awaiting the next entry.
				// Resolve the promise.
				const { value, next } = entries.shift()!;
				resolve0({ value, done: false });
				resolve0 = undefined;
				reject0 = undefined;
				next();
				return;
			}
			// Otherwise, forward entries to the user handler, if any
			else if (entryHandler != null) {
				entryHandler(entries.shift()!);
			}
		}
		// There are no pending entries, propagate the error instead, if any
		else if (error != null && reject0 != null) {
			reject0(error);
			resolve0 = undefined;
			reject0 = undefined;
			error = undefined;
		}
	}

	function onentry(
		headers: tar.Headers,
		data: stream.Readable,
		callback: tar.Callback,
	) {
		entries.push({ value: { headers, data }, next: callback });
		tick();
	}

	function onerror(err: Error) {
		if (error == null) {
			error = err;
		}
	}

	function onnext(
		resolve: (res: Result) => void,
		reject: (err: Error) => void,
	) {
		if (resolve0 != null) {
			throw new Error('Attempt to concurrently iterate over entries');
		}
		resolve0 = resolve;
		reject0 = reject;
		tick();
	}

	function destroy(err?: Error): Promise<Result> {
		const promise = new Promise<Result>((resolve, reject) => {
			extract.once('close', () => {
				if (err != null) {
					reject(err);
				} else {
					resolve({ value: undefined, done: true });
				}
			});
		});
		if (err != null) {
			onerror(err);
			tick();
		}
		return promise;
	}

	function assertNoEntryHandler() {
		if (entryHandler != null) {
			throw new Error(
				'There is an entry handler registered; the iterator is unusable',
			);
		}
	}

	extract.on('entry', onentry);
	extract.on('error', onerror);

	return {
		[Symbol.asyncIterator]() {
			return this;
		},
		next(): Promise<Result> {
			assertNoEntryHandler();
			return new Promise(onnext);
		},
		return(): Promise<Result> {
			assertNoEntryHandler();
			return destroy();
		},
		throw(err: Error): Promise<Result> {
			assertNoEntryHandler();
			return destroy(err);
		},
		resume(cb: EntryHandler) {
			entryHandler = cb;
			tick();
		},
	};
}

export interface ReadableBundle<T> {
	readonly version: string;
	readonly type: string;
	readonly manifest: T;
	readonly resources: Resource[];
}

export async function read<T>(
	input: stream.Readable,
	type: string,
	publicKey?: string,
): Promise<ReadableBundle<T>> {
	const extract = tar.extract();
	const entries = makeEntriesIterator(extract);

	stream.pipeline(input, extract, (err) => {
		if (err) {
			extract.emit('error', err);
		}
	});

	// Read contents.json

	let entry = await entries.next();
	if (entry.value == null || entry.done) {
		throw new Error('Unexpected end of stream');
	}
	let name = entry.value.headers.name;
	if (name !== CONTENTS_JSON) {
		throw new Error(`Unexpected file in read bundle ${name}`);
	}
	const contentsStr = await streamToString(entry.value.data);

	// Read contents.sig

	entry = await entries.next();
	if (entry.value == null || entry.done) {
		throw new Error('Unexpected end of stream');
	}
	name = entry.value.headers.name;
	if (name !== CONTENTS_SIG) {
		throw new Error(`Unexpected file in read bundle ${name}`);
	}
	const contentsSigStr = await streamToString(entry.value.data);
	const contentsSig = JSON.parse(contentsSigStr);

	// Validate integrity and signature

	const { digest, signature } = contentsSig;
	if (digest == null) {
		throw new Error(`${CONTENTS_JSON} integrity could not be verified`);
	}
	if (sha256sum(contentsStr) !== digest) {
		throw new Error(`${CONTENTS_JSON} appears to be corrupted`);
	}
	if (signature != null) {
		if (publicKey == null) {
			throw new Error('Signed bundle requires a public key to be provided');
		}
		if (!signer.isValid(publicKey, signature, contentsStr)) {
			throw new Error(`${CONTENTS_JSON} has invalid signature`);
		}
	} else {
		if (publicKey != null) {
			throw new Error('Public key provided but bundle is missing signature');
		}
	}

	// Parse and validate contents

	const contents: Contents<T> = JSON.parse(contentsStr);

	const requiredKeys = ['version', 'type', 'manifest', 'resources'];
	for (const key of requiredKeys) {
		if (!(key in contents)) {
			throw new Error(`Missing "${key}" in ${CONTENTS_JSON}`);
		}
	}
	if (contents.version !== CURRENT_BUNDLE_VERSION) {
		throw new Error(
			`Unsupported bundle version ${contents.version} (expected ${CURRENT_BUNDLE_VERSION})`,
		);
	}
	if (contents.type !== type) {
		throw new Error(
			`Expected type (${type}) does not match received type (${contents.type})`,
		);
	}

	for (const resource of contents.resources) {
		const requiredResourceKeys = ['id', 'size', 'digest'];
		for (const key of requiredResourceKeys) {
			if (!(key in resource)) {
				throw new Error(`Missing "${key}" in "resources" of ${CONTENTS_JSON}`);
			}
		}

		if (resource.digest.includes(':') === false) {
			throw new Error(`Resource with malformed digest ${resource.digest}`);
		}
	}

	// Extract resources

	const resources: Resource[] = [];

	const resourceIds = contents.resources.map(({ id }) => id);
	const uniqueIds = new Set(resourceIds);
	if (resourceIds.length !== uniqueIds.size) {
		const duplicateIds = resourceIds.filter((id) => !uniqueIds.delete(id));
		throw new Error(
			`Duplicate resource IDs found in contents.json: ${duplicateIds}`,
		);
	}
	resources.push(
		...contents.resources.map((descriptor) => {
			return {
				...descriptor,
				data: new stream.PassThrough(),
			};
		}),
	);

	// Register a custom entry handler to properly forward entries into
	// their respective resource streams without having to await each.
	// This makes the iterator unusable from this point on.
	entries.resume(({ value: { headers, data }, next }) => {
		const path = headers.name;

		const filename = path.split(`${RESOURCES_DIR}/`)[1];
		if (filename == null) {
			return next(new Error(`Unexpected file in read bundle ${path}`));
		}

		const matchingResources = resources.filter(
			(desc) => sha256sum(desc.id) === filename,
		);

		if (matchingResources.length === 0) {
			return next(new Error(`Unknown resource ${path}`));
		}

		const resource = matchingResources[0];

		if (matchingResources.length > 1) {
			return next(new Error(`Resources with duplicated ID ${resource.id}`));
		}

		const hasher = new Hasher(resource.digest);
		const dest = resource.data as stream.PassThrough;

		stream.pipeline(data, hasher, dest, next);
	});

	return {
		version: contents.version,
		type: contents.type,
		manifest: contents.manifest,
		resources,
	};
}
