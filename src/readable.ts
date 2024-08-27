import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type {
	Envelope,
	MultipartResource,
	ReadableBundle,
	ReadableResource,
	Resource,
	ResourceDescriptor,
} from './types';
import {
	CONTENTS_JSON,
	CONTENTS_SIG,
	CURRENT_BUNDLE_VERSION,
	RESOURCES_DIR,
} from './constants';
import {
	checkProperties,
	checkUnique,
	flatMapResources,
	isMultipartResource,
	mapResources,
	streamToString,
} from './utils';
import * as signer from './signer';

export interface OpenOptions {
	publicKey?: string;
}

export async function open<ManifestType>(
	input: stream.Readable,
	type: string,
	options: OpenOptions | undefined = {},
): Promise<ReadableBundle<ManifestType>> {
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
		if (options.publicKey == null) {
			throw new Error('Signed bundle requires a public key to be provided');
		}
		if (!signer.isValid(options.publicKey, signature, contentsStr)) {
			throw new Error(`${CONTENTS_JSON} has invalid signature`);
		}
	} else {
		if (options.publicKey != null) {
			throw new Error('Public key provided but bundle is missing signature');
		}
	}

	// Parse and validate contents
	// TODO: use json schema instead

	const envelope: Envelope<ManifestType> | undefined = JSON.parse(contentsStr);
	if (envelope == null) {
		throw new Error(`Failed to read ${CONTENTS_JSON}`);
	}

	checkProperties(
		envelope,
		['schemaVersion', 'contents'],
		`Missing key in ${CONTENTS_JSON}`,
	);

	if (envelope.schemaVersion !== CURRENT_BUNDLE_VERSION) {
		throw new Error(
			`Unsupported bundle version ${envelope.schemaVersion} (expected ${CURRENT_BUNDLE_VERSION})`,
		);
	}

	const { contents } = envelope;
	validateBundleDescription(contents);

	if (contents.type !== type) {
		throw new Error(
			`Expected type (${type}) does not match received type (${contents.type})`,
		);
	}

	// Extract resources

	// Attach a PassThroughStream to each resource that we'll use to
	// pipe data into, as it's being read by `entries`.
	const resources = mapResources(contents.resources, (resource) => ({
		...resource,
		data: new stream.PassThrough(),
	}));

	// Make a flat list of all streamable resources.
	const flatResources = flatMapResources(resources, (resource) => resource);

	// Register a custom entry handler to properly forward entries into
	// their respective resource streams without having to await each.
	// This makes the iterator unusable from this point on.
	entries.resume(({ value: { headers, data }, next }) => {
		const path = headers.name;

		const filename = path.split(`${RESOURCES_DIR}/`)[1];
		if (filename == null) {
			return next(new Error(`Unexpected file in bundle ${path}`));
		}

		// Resources are expected to be added to the tar stream in the order
		// they were declared (iteration on multipart resources is depth-first)
		const resource = flatResources.shift();
		if (resource == null) {
			return next(new Error(`Unexpected file in bundle ${path}`));
		}

		const ref = sha256sum(resource.id);
		if (ref !== filename) {
			const actual = flatResources.find((r) => sha256sum(r.id) === filename);
			if (actual != null) {
				// the resource exists but appeared earlier than expected,
				// which means the order of resources in the stream is messed up
				return next(
					new Error(
						`Cannot read resources out of order; expected to read '${resource.id}' but read '${actual.id}' instead`,
					),
				);
			}
			return next(new Error(`Unknown resource ${path}`));
		}

		const hasher = new Hasher(resource.digest);
		const dest = resource.data as stream.PassThrough;

		stream.pipeline(data, hasher, dest, next);
	});

	return new _ReadableBundleImpl({
		type: contents.type,
		manifest: contents.manifest,
		resources,
	});
}

type ReadableBundleContents<ManifestType> = MultipartResource<
	ManifestType,
	ReadableResource
>['contents'];

class _ReadableBundleImpl<ManifestType>
	implements ReadableBundle<ManifestType>
{
	private _contents: ReadableBundleContents<ManifestType>;

	constructor(contents: ReadableBundleContents<ManifestType>) {
		this._contents = contents;
	}

	get type() {
		return this._contents.type;
	}

	get manifest() {
		return this._contents.manifest;
	}

	get resources() {
		// merely upcasting resources as descriptors allows
		// some flexibility with multipart resources that
		// isn't otherwise easy to get
		return this._contents.resources as ResourceDescriptor[];
	}

	private _getResource(id: string) {
		const resource = this._contents.resources.find((r) => r.id === id);
		if (resource == null) {
			throw new Error(`Resource '${id}' not found in bundle`);
		}
		return resource;
	}

	read(descriptor: ResourceDescriptor): ReadableResource {
		if ('data' in descriptor) {
			// see comment in this.resources getter why that is likely to succeed
			return descriptor as ReadableResource;
		}
		const resource = this._getResource(descriptor.id);
		if (isMultipartResource<any, ReadableResource>(resource)) {
			throw new Error(`Resource '${descriptor.id} is a multipart resource`);
		}
		return resource;
	}

	readMultipart<T>(descriptor: ResourceDescriptor): ReadableBundle<T> {
		let resource: ReadableResource | MultipartResource<T, ReadableResource>;
		if ('contents' in descriptor) {
			// see comment in this.resources getter why that is likely to succeed
			resource = descriptor as any;
		} else {
			resource = this._getResource(descriptor.id);
		}
		if (!isMultipartResource<T, ReadableResource>(resource)) {
			throw new Error(`Resource '${descriptor.id} is not a multipart resource`);
		}
		return new _ReadableBundleImpl(resource.contents);
	}

	get contents() {
		return this._contents;
	}
}

function validateBundleDescription<T>(description: Envelope<T>['contents']) {
	checkProperties(
		description,
		['type', 'manifest', 'resources'],
		'Missing key in bundle description',
	);

	function validateResource(rawResource: Resource) {
		checkProperties(
			rawResource,
			['id', 'size', 'digest'],
			'Missing key in resource',
		);
		if (rawResource.digest.includes(':') === false) {
			throw new Error(`Resource with malformed digest ${rawResource.digest}`);
		}
	}

	function validateMultipartResource(
		rawResource: MultipartResource<T, Resource>,
	) {
		checkProperties(
			rawResource,
			['id', 'contents'],
			'Missing key in multipart resource',
		);
		validateBundleDescription(rawResource.contents);
	}

	for (const resource of description.resources) {
		if (isMultipartResource(resource)) {
			validateMultipartResource(resource);
		} else {
			validateResource(resource);
		}
	}

	function validateResourceIDs(descriptors: ResourceDescriptor[]) {
		const resourceIds = descriptors.map(({ id }) => id);
		checkUnique(
			resourceIds,
			'Duplicate resource IDs in bundle description are not allowed (use "aliases" instead)',
		);
		for (const descriptor of descriptors) {
			if (isMultipartResource(descriptor)) {
				validateResourceIDs(descriptor.contents.resources);
			}
		}
	}
	validateResourceIDs(description.resources);
}

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
