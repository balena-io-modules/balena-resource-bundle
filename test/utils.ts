import * as stream from 'node:stream';
import * as tar from 'tar-stream';

import * as bundle from '../src';

import { sha256sum } from '../src/hasher';
import type { Envelope } from '../src/types';

export class ErroringStream extends stream.Readable {
	shouldError: boolean = false;

	constructor(private content: string) {
		super({ objectMode: false });
	}

	_read() {
		if (this.shouldError) {
			this.emit('error', new Error('ErroringStream is throwing an error'));
		} else {
			this.push(this.content);

			this.shouldError = true;
		}
	}
}

export function createTarBundle(contents: Envelope<any>) {
	const pack = tar.pack();

	const contentsJson = JSON.stringify(contents);

	pack.entry({ name: 'contents.json' }, contentsJson);

	const signature = {
		digest: sha256sum(contentsJson),
	};

	pack.entry({ name: 'contents.sig' }, JSON.stringify(signature));

	return pack;
}

export async function createEmptyBundle(contents: any) {
	const pack = createTarBundle(contents);

	pack.finalize();

	const readable = await bundle.open(pack, 'foo@1');

	return readable;
}

function dropData(resource: bundle.Resource): bundle.Resource {
	const copy = {
		...resource,
	};
	delete (copy as any).data;
	return copy;
}

export async function gather(
	contents: bundle.ReadableBundle<any>,
): Promise<{ data: string[]; resources: bundle.Resource[] }> {
	const data: string[] = [];
	const resources: bundle.Resource[] = [];

	for (const descriptor of contents.resources) {
		if (bundle.isMultipartResource(descriptor)) {
			const resource = contents.readMultipart(descriptor);
			const result = await gather(resource);
			data.push(...result.data);
			resources.push(...result.resources);
		} else {
			const resource = contents.read(descriptor);
			const str = await bundle.streamToString(resource.data);
			data.push(str);
			resources.push(dropData(resource));
		}
	}

	return { data, resources };
}
