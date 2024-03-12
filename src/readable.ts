import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { Hasher, sha256sum } from './hasher';
import type { Contents } from './types';
import { CONTENTS_JSON, CURRENT_BUNDLE_VERSION, RESOURCES_DIR } from './types';
import * as signer from './signer';

// TODO: Add a close method that closes the tar stream, so that we do not leak
class ReadableBundle<T> {
	// TODO: Mark fields as private
	extract: tar.Extract;
	type: string;
	contents: Contents<T> | undefined;
	iterator: AsyncIterator<tar.Entry, any, undefined>;
	publicKey?: string;

	constructor(input: stream.Readable, type: string, publicKey?: string) {
		const extract = tar.extract();

		stream.pipeline(input, extract, (err) => {
			// TODO: Figure out more details about this callback
			if (err) {
				throw err;
			}
		});

		this.type = type;
		this.extract = extract;
		this.iterator = extract[Symbol.asyncIterator]();
		this.publicKey = publicKey;
	}

	async manifest(): Promise<T> {
		if (this.contents != null) {
			return this.contents.manifest;
		}

		const entry: tar.Entry = (await this.iterator.next()).value;

		const entrySig: tar.Entry = (await this.iterator.next()).value;

		// TODO: Validate this is indeed contents.json and add test for this

		const contentsRes = new Response(entry as any);
		const contentsStr = await contentsRes.text();

		// TODO: !!!! MAKE SURE CONTENTS.SIG IS NOT MALICIOUS !!!!
		const contentsSigRes = new Response(entrySig as any);
		const contentsSigStr = await contentsSigRes.text();
		const contentsSig = JSON.parse(contentsSigStr);

		// TODO: Add tests for all edge cases

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

		// FROM HERE IT IS SAFE TO WORK WITH contents.json

		// TODO: Extract converting stream to json into separate function
		// TODO: See what this does more specifically with the debugger
		const contents: Contents<T> = JSON.parse(contentsStr);
		this.contents = contents;

		// TODO: Make sure we cover all the validation needed for contents.json

		const requiredKeys = ['version', 'type', 'manifest', 'resources'];
		for (const key of requiredKeys) {
			if (!(key in contents)) {
				throw new Error(`Missing "${key}" in ${CONTENTS_JSON}`);
			}
		}

		// TODO: Do version negotiation
		// TODO: Add a test for version mismatch
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
		}

		// TODO: Validate the specific fields of resources contents here
		// This way we will not have to re-validate when we use it
		// TODO: Also add tests for each added validation

		return this.contents.manifest;
	}

	async *resources() {
		if (this.contents == null) {
			throw new Error('Must call `manifest()` before `resources()`');
		}

		while (true) {
			const result = await this.iterator.next();
			if (result.done) {
				break;
			}

			const entry = result.value;

			const path = entry.header.name;

			// TODO: Should we error out when encountering entries that are
			// not resources or we should skip those?

			// TODO: Check node.js path library for splitting this
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

			// TODO: Test for duplicated resources
			const hasher = new Hasher(descriptors[0].digest);

			// TODO: Expose accessing resources descriptors stored in contents.json

			stream.pipeline(entry, hasher, (err) => {
				// TODO: How to handle this error?
				// TODO: How to test this.
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
