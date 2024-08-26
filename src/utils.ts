import * as stream from 'node:stream';

import type {
	BundleDescription,
	MultipartResource,
	Resource,
	ResourceDescriptor,
} from './types';

export function isMultipartResource<T = any, ResourceType = Resource>(
	resource: ResourceDescriptor,
): resource is MultipartResource<T, ResourceType> {
	try {
		checkProperties<MultipartResource<T, ResourceType>>(
			resource as any,
			['id', 'contents'],
			'-',
		);
		checkProperties<MultipartResource<T, ResourceType>['contents']>(
			(resource as any).contents,
			['type', 'manifest', 'resources'],
			'-',
		);
		return true;
	} catch (err) {
		return false;
	}
}

export function describeResource<T>(
	resource: Resource | MultipartResource<T, Resource>,
): ResourceDescriptor {
	const descriptor: ResourceDescriptor = {
		id: resource.id,
	};
	if ('aliases' in resource) {
		descriptor['aliases'] = resource.aliases;
	}
	if ('type' in resource) {
		descriptor['type'] = resource.type;
	}
	if ('metadata' in resource) {
		descriptor['metadata'] = resource.metadata;
	}
	return descriptor;
}

export function mapResources<T, ResourceType>(
	resources: Array<Resource | MultipartResource<T, Resource>>,
	callback: (resource: Resource) => ResourceType,
): Array<ResourceType | MultipartResource<T, ResourceType>> {
	return resources.map((resource) => {
		if (isMultipartResource(resource)) {
			return {
				...resource,
				contents: {
					...resource.contents,
					resources: mapResources(resource.contents.resources, callback),
				},
			};
		} else {
			return callback(resource);
		}
	});
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

// Internal

export function checkProperties<T extends object>(
	obj: T,
	names: Array<keyof T>,
	msg: string,
) {
	for (const key of names) {
		if (!(key in obj)) {
			throw new Error(`${msg}: "${String(key)}"`);
		}
	}
}

export function checkUnique<T>(values: T[], msg: string) {
	const uniqueValues = new Set(values);
	if (values.length !== uniqueValues.size) {
		const dupes = values.filter((value) => !uniqueValues.delete(value));
		throw new Error(`${msg}: ${dupes.join(', ')}`);
	}
}

export type ResourceHandler = (
	resource: Resource,
	data: stream.Readable,
	next: (err?: Error) => void,
) => void | Promise<void>;

/**
 * Given an iterator over an array of resources, invoke `packEntry` for each resource.
 *
 * If any resource is a multipart resource, it will recurse into the resources of
 * the multipart resource, in a depth-first way.
 *
 * If any resource provides data lazily, it will ask for data "just in time" the data is
 * needed to be added to the tar stream, and await the returned promise.
 *
 * If the resource handler is itself an async function, then it must still invoke `next`
 * as appropriate.
 *
 * The resource data stream is merely passed around and the resource handler still has
 * to destroy the stream as appropriate on failure.
 */
export function scheduleResources<T>(
	iter: Iterator<BundleDescription<T>['resources'][0]>,
	fn: ResourceHandler,
	done: (err?: Error) => void,
) {
	const result = iter.next();
	if (result.done) {
		done();
		return;
	}
	const resource = result.value;

	function next(err?: Error) {
		if (err != null) {
			done(err);
		} else {
			setImmediate(() => scheduleResources(iter, fn, done));
		}
	}

	if (isMultipartResource(resource)) {
		scheduleResources(resource.contents.resources.values(), fn, next);
	} else if (typeof resource.data === 'function') {
		schedulePromise(resource, resource.data, fn, next);
	} else if (resource.data instanceof stream.Readable) {
		try {
			// an async function still needs to call `next` as appropriate
			// so we don't need to wire up the returned promise here.
			void fn(resource, resource.data, next);
		} catch (err) {
			next(err);
		}
	} else {
		next(new Error(`Invalid data for resource with ID '${resource.id}'`));
	}
}

function schedulePromise(
	resource: Resource,
	deferred: (resource: Resource) => Promise<stream.Readable>,
	fn: ResourceHandler,
	next: (err?: Error) => void,
) {
	try {
		Promise.resolve(deferred(resource)).then(
			(data) => fn(resource, data, next),
			next,
		);
	} catch (err) {
		next(err);
	}
}
