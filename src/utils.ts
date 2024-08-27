import * as stream from 'node:stream';

import type {
	AnyResource,
	MultipartResource,
	ResourceDescriptor,
	WritableResource,
} from './types';

export function isMultipartResource<T, ResourceType extends ResourceDescriptor>(
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

export function describeResource<ResourceType extends ResourceDescriptor>(
	resource: AnyResource<ResourceType>,
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

export type TransformCallback<
	ResourceType extends ResourceDescriptor,
	Result,
> = (
	resource: ResourceType,
	parents: Array<MultipartResource<any, ResourceType>>,
) => Result;

export function mapResources<
	ResourceType extends ResourceDescriptor,
	Result extends ResourceDescriptor,
>(
	resources: Array<AnyResource<ResourceType>>,
	callback: TransformCallback<ResourceType, Result>,
	parents: Array<MultipartResource<any, ResourceType>> = [],
): Array<AnyResource<Result>> {
	return resources.map((resource) => {
		if (isMultipartResource(resource)) {
			parents.push(resource);

			const result = mapResources(
				resource.contents.resources,
				callback,
				parents,
			);

			parents.pop();

			return {
				...resource,
				contents: {
					...resource.contents,
					resources: result,
				},
			};
		} else {
			return callback(resource, parents);
		}
	});
}

export function flatMapResources<
	ResourceType extends ResourceDescriptor,
	Result,
>(
	resources: Array<AnyResource<ResourceType>>,
	callback: TransformCallback<ResourceType, Result>,
	parents: Array<MultipartResource<any, ResourceType>> = [],
): Result[] {
	return resources
		.map((resource) => {
			if (isMultipartResource(resource)) {
				parents.push(resource);

				const result = flatMapResources(
					resource.contents.resources,
					callback,
					parents,
				);

				parents.pop();

				return result;
			} else {
				return [callback(resource, parents)];
			}
		})
		.flat();
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

export type ResourceHandler<ResourceType> = (
	resource: ResourceType,
	data: stream.Readable,
	next: (err?: Error) => void,
) => void | Promise<void>;

/**
 * Given an iterator over an array of resources, invoke a callback for each resource.
 *
 * If any resource is a multipart resource, this function will recurse into the resources
 * of that multipart resource, in a depth-first way.
 *
 * If any resource provides data lazily via an async function, it will be invoked and
 * awaited to retrieve the data stream. If the function throws synchronously or results
 * in a rejected promise, then the error will be forwarded to `next` automatically and
 * scheduling will end (invoking the `done` callback with the thrown error).
 *
 * If the resource handler is itself an async function, then it must still invoke `next`
 * as appropriate. Errors thrown from within the handler either synchronously or that
 * result in a rejected promise will be forwarded to `next` automatically and scheduling
 * will end (invoking the `done` callback with the thrown error).
 *
 * The resource data streams are merely passed around and the resource handler must always
 * handle errors and destroy the streams as appropriate on failure and communicate the
 * result via `next`. This function will never register error handlers on data streams.
 */
export function scheduleResources<ResourceType extends WritableResource>(
	iter: Iterator<AnyResource<ResourceType>>,
	fn: ResourceHandler<ResourceType>,
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

	function invokeCallback(res: ResourceType, data: stream.Readable) {
		try {
			Promise.resolve(fn(res, data, next)).catch(next);
		} catch (err) {
			next(err);
		}
	}

	if (isMultipartResource(resource)) {
		scheduleResources(resource.contents.resources.values(), fn, next);
	} else if (typeof resource.data === 'function') {
		try {
			Promise.resolve(resource.data(resource)).then(
				(data) => invokeCallback(resource, data),
				next,
			);
		} catch (err) {
			next(err);
		}
	} else if (resource.data instanceof stream.Readable) {
		invokeCallback(resource, resource.data);
	} else {
		next(new Error(`Invalid data for resource with ID '${resource.id}'`));
	}
}

// Internal

export function toPrettyJSON(obj: any): string {
	return JSON.stringify(obj, null, 2);
}

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
