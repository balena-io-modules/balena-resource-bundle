import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type { Contents } from './types';
import { CONTENTS_JSON, CURRENT_BUNDLE_VERSION, RESOURCES_DIR } from './types';
import * as signer from './signer';

class ReadableBundle<T> {
	readonly type: string;
	readonly publicKey?: string;
	private contents: Contents<T> | undefined;
	private iterator: AsyncIterator<tar.Entry, any, undefined> | null;

	constructor(input: stream.Readable, type: string, publicKey?: string) {
		const extract = tar.extract();

		stream.pipeline(input, extract, (err) => {
			if (err) {
				throw err;
			}
		});

		this.type = type;
		this.iterator = extract[Symbol.asyncIterator]();
		this.publicKey = publicKey;
	}

	public async manifest(): Promise<T> {
		if (this.contents != null) {
			return this.contents.manifest;
		}

		if (this.iterator == null) {
			throw new Error('Iterator is already drained');
		}

		const entry: tar.Entry = (await this.iterator.next()).value;

		const entrySig: tar.Entry = (await this.iterator.next()).value;

		const contentsRes = new Response(entry as any);
		const contentsStr = await contentsRes.text();

		const contentsSigRes = new Response(entrySig as any);
		const contentsSig = await contentsSigRes.json();

		const { digest, signature } = contentsSig;
		if (digest == null) {
			throw new Error(`${CONTENTS_JSON} integrity could not be verified`);
		}

		if (sha256sum(contentsStr) !== digest) {
			throw new Error(`${CONTENTS_JSON} appears to be corrupted`);
		}

		if (signature != null) {
			if (this.publicKey == null) {
				throw new Error('Signed bundle requires a public key to be provided');
			}

			if (!signer.isValid(this.publicKey, signature, contentsStr)) {
				throw new Error(`${CONTENTS_JSON} has invalid signature`);
			}
		} else {
			if (this.publicKey != null) {
				throw new Error('Public key provided but bundle is missing signature');
			}
		}

		const contents: Contents<T> = JSON.parse(contentsStr);
		this.contents = contents;

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

		if (contents.type !== this.type) {
			throw new Error(
				`Expected type (${this.type}) does not match received type (${contents.type})`,
			);
		}

		for (const resource of contents.resources) {
			const requiredResourceKeys = ['id', 'size', 'digest'];
			for (const key of requiredResourceKeys) {
				if (!(key in resource)) {
					throw new Error(
						`Missing "${key}" in "resources" of ${CONTENTS_JSON}`,
					);
				}
			}

			if (resource.digest.includes(':') === false) {
				throw new Error(`Resource with malformed digest ${resource.digest}`);
			}
		}

		return this.contents.manifest;
	}

	public async *resources() {
		if (this.contents == null) {
			throw new Error('Must call `manifest()` before `resources()`');
		}

		if (this.iterator == null) {
			throw new Error('resources() is already called');
		}

		while (true) {
			const result = await this.iterator.next();
			if (result.done) {
				this.iterator = null;
				break;
			}

			const entry = result.value;

			const path = entry.header.name;

			// TODO: Validate this split
			const filename = path.split(`${RESOURCES_DIR}/`)[1];

			const descriptors = this.contents.resources.filter(
				// TODO: What happens if this split is broken and how to break it in test?
				(descriptor) => descriptor.digest.split(':')[1] === filename,
			);

			if (descriptors.length === 0) {
				// TODO: Improve error message
				throw new Error('Unknown resource');
			}

			const hasher = new Hasher(descriptors[0].digest);

			stream.pipeline(entry, hasher, (err) => {
				if (err) {
					// TODO: Tests work when commenting this out???
					hasher.emit('error', err);
				}
			});

			// TODO: Define interface for this return type
			yield {
				resource: hasher,
				descriptors,
			};
		}
	}
}

export function open<T>(
	input: stream.Readable,
	type: string,
	publicKey?: string,
): ReadableBundle<T> {
	return new ReadableBundle(input, type, publicKey);
}
