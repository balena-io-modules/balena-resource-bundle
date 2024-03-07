export const CURRENT_BUNDLE_VERSION = '1';
export const CONTENTS_JSON = 'contents.json';
export const RESOURCES_DIR = 'resources';

// TODO: Tansfer back schema to specification on Fibery
export interface Resource {
	id: string;
	size: number;
	digest: string;
	type?: string;
}

export interface Contents<T> {
	version: string;
	type: string;
	manifest: T;
	resources: Resource[];
}
