import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import Hasher from './hasher';
import type { Contents } from './contents';
import {
	CONTENTS_JSON,
	CURRENT_BUNDLE_VERSION,
	RESOURCES_DIR,
} from './contents';

class ReadableBundle<T> {
	// TODO: Mark fields as private
	extract: tar.Extract;
	type: string;
	contents: Contents<T> | undefined;
	iterator: AsyncIterator<tar.Entry, any, undefined>;

	constructor(input: stream.Readable, type: string) {
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
	}

	private async parseContents(entry: tar.Entry): Promise<Contents<T>> {
		// TODO: Add a test for already parsed contents.json
		if (this.contents != null) {
			throw new Error(`${CONTENTS_JSON} is already parsed`);
		}

		// TODO: Validate this is indeed contents.json and add test for this

		// TODO: Extract converting stream to json into separate function
		// TODO: See what this does more specifically with the debugger
		const contents: Contents<T> = await new Response(entry as any).json();

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

		return contents;
	}

	async manifest(): Promise<T> {
		if (this.contents != null) {
			return this.contents.manifest;
		}

		const result = await this.iterator.next();

		const entry = result.value;

		this.contents = await this.parseContents(entry);

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
					throw err;
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
): ReadableBundle<T> {
	return new ReadableBundle(input, type);
}
