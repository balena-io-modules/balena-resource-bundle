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

interface _BundleDescription<ManifestType, ResourceType> {
	type: string;
	manifest: ManifestType;
	resources: Array<ResourceType | MultipartResource<any, ResourceType>>;
}

// Types for creating bundles

/** A resource and associated data that can be added into a bundle */
export interface WritableResource extends Resource {
	data: stream.Readable | ((resource: Resource) => Promise<stream.Readable>);
}

/** A multipart resource allows embedding complete bundle descriptions
 * into another bundle */
export interface MultipartResource<ManifestType, ResourceType = Resource>
	extends ResourceDescriptor {
	contents: _BundleDescription<ManifestType, ResourceType>;
}

/** A complete description and all associated data that can be used to
 * create a bundle. */
export type BundleDescription<ManifestType> = _BundleDescription<
	ManifestType,
	WritableResource
>;

/** Types that can be described as a bundle implement this type to vend
 * the appropriate description. */
export interface BundleConvertible<ManifestType> {
	readonly contents: BundleDescription<ManifestType>;
}

// Types for reading bundles

/** A resource and associated data that can be read from a bundle */
export interface ReadableResource extends WritableResource {
	data: stream.Readable;
}

/** The primary interface for reading bundles and contained multipart resources */
export interface ReadableBundle<ManifestType>
	extends BundleConvertible<ManifestType> {
	readonly type: string;
	readonly manifest: ManifestType;

	readonly resources: ResourceDescriptor[];
	read(descriptor: ResourceDescriptor): ReadableResource;
	readMultipart<T>(descriptor: ResourceDescriptor): ReadableBundle<T>;

	readonly contents: _BundleDescription<ManifestType, ReadableResource>;
}

// Internal types

export type Envelope<ManifestType> = {
	schemaVersion: string;
	contents: _BundleDescription<ManifestType, Resource>;
};

export type Signature = {
	digest: string;
	signature?: string;
};
