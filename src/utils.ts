import * as stream from 'node:stream';

import type { ReadableResource, Resource, WritableResource } from './types';

export function describeResource(
	resource: ReadableResource | WritableResource,
): Resource {
	const descriptor = { ...resource };
	delete (descriptor as any).data;
	return descriptor;
}

export function toPrettyJSON(obj: any): string {
	return JSON.stringify(obj, null, 2);
}

export function stringToStream(str: string): stream.Readable {
	return stream.Readable.from([str], { objectMode: false });
}

export async function streamToString(source: stream.Readable): Promise<string> {
	let str = '';

	return new Promise((resolve, reject) => {
		source.on('data', (data) => {
			str += data.toString();
		});

		source.on('end', () => resolve(str));

		source.on('error', reject);
	});
}
