import type * as stream from 'node:stream';

export interface ResourceDescriptor {
	id: string;
	aliases?: string[];
	size: number;
	digest: string;
	type?: string;
	metadata?: {
		[key: string]: any;
	};
}

export interface Resource extends ResourceDescriptor {
	data: stream.Readable;
}

export interface Contents<T> {
	version: string;
	type: string;
	manifest: T;
	resources: ResourceDescriptor[];
}

export interface Signature {
	digest: string;
	signature?: string;
}
