import type * as stream from 'node:stream';

export type ResourceDescriptor = {
	id: string;
	aliases?: string[];
	type?: string;
	metadata?: {
		[key: string]: any;
	};
};

export type Resource = ResourceDescriptor & {
	size: number;
	digest: string;
};

export type WritableResource = Resource & {
	data: stream.Readable | ((resource: Resource) => Promise<stream.Readable>);
};

export type ReadableResource = Resource & {
	data: stream.Readable;
};

export type BundleDescription<ManifestType, ResourceType = Resource> = {
	type: string;
	manifest: ManifestType;
	resources: ResourceType[];
};

// Internal types

export type Contents<ManifestType> = {
	version: string;
	type: string;
	manifest: ManifestType;
	resources: Resource[];
};

export type Signature = {
	digest: string;
	signature?: string;
};
