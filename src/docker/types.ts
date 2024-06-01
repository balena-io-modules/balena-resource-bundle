export interface ImageBlob {
	mediaType: string;
	size: number;
	digest: string;
}

export interface ImageManifest {
	schemaVersion: number;
	mediaType: string;
	config: ImageBlob;
	layers: [ImageBlob];
}

export interface ImageDescriptor {
	registry: string;
	repository: string;
	reference: string;
}

export interface Image {
	descriptor: ImageDescriptor;
	manifest: ImageManifest;
}
