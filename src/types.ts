import type * as stream from 'node:stream';

// Basic types

export interface ResourceDescriptor {
	id: string;
	aliases?: string[];
	type?: string;
	metadata?: Record<string, string | number | boolean>;
}

/** A resource with no associated data */
export interface Resource extends ResourceDescriptor {
	size: number;
	digest: string;
}

type _BundleDescription<
	ManifestType,
	ResourceType extends ResourceDescriptor,
> = {
	type: string;
	manifest: ManifestType;
	resources: ResourceType[];
};

/** Types that can be described as a bundle implement this type to vend
 * an appropriate description. */
export interface BundleConvertible<
	ManifestType,
	ResourceType extends ResourceDescriptor,
> {
	readonly contents: _BundleDescription<ManifestType, ResourceType>;
}

/** Types that work with multipart resources use this type as a shorthand
 * to refer to either regular or multipart resources.
 */
export type AnyResource<ResourceType extends ResourceDescriptor> =
	| ResourceType
	| MultipartResource<any, ResourceType>;

// Types for creating bundles

/** A resource and associated data that can be added into a bundle */
export interface WritableResource extends Resource {
	data: stream.Readable | ((resource: Resource) => Promise<stream.Readable>);
}

/** A multipart resource allows embedding complete bundle descriptions
 * into another bundle */
export interface MultipartResource<
	ManifestType,
	ResourceType extends ResourceDescriptor,
> extends ResourceDescriptor {
	contents: _BundleDescription<ManifestType, AnyResource<ResourceType>>;
}

/** A complete description and all associated data that can be used to
 * create a bundle. */
export type BundleDescription<ManifestType> = _BundleDescription<
	ManifestType,
	AnyResource<WritableResource>
>;

// Types for reading bundles

/** A resource and associated data that can be read from a bundle */
export interface ReadableResource extends WritableResource {
	data: stream.Readable;
}

/**
 * The primary interface for reading bundles and contained multipart resources.
 *
 * Besides using the interface to read bundle contents, a readable bundle can also
 * be directly written into another bundle via its `ReadableBundle.contents` property.
 */
export interface ReadableBundle<ManifestType>
	extends BundleConvertible<ManifestType, AnyResource<ReadableResource>> {
	readonly type: string;
	readonly manifest: ManifestType;

	readonly resources: ResourceDescriptor[];
	read(descriptor: ResourceDescriptor): ReadableResource;
	readMultipart<T>(descriptor: ResourceDescriptor): ReadableBundle<T>;
}

// Internal types

export type Envelope<ManifestType> = {
	schemaVersion: string;
	contents: _BundleDescription<ManifestType, AnyResource<Resource>>;
};

export type Signature = {
	digest: string;
	signature?: string;
};
