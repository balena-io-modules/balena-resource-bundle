import type * as stream from 'node:stream';

import { create, read, docker, type Resource } from '..';

export const BALENA_UPDATE_TYPE = 'io.balena.update@1';

export interface UpdateBundleManifest {
	state: any;
	images: docker.Image[];
}

export async function createUpdateBundle(
	images: docker.ImageDescriptor[],
	state: any,
): Promise<stream.Readable> {
	const allImages: docker.Image[] = [];
	const allBlobs: Resource[] = [];

	for (const descriptor of images) {
		const { image, blobs } = await docker.fetchImage(descriptor);
		allImages.push(image);
		allBlobs.push(...blobs);
	}

	return create<UpdateBundleManifest>({
		type: BALENA_UPDATE_TYPE,
		manifest: {
			state,
			images: allImages,
		},
		resources: allBlobs,
	});
}

export interface ReadableUpdateBundle {
	readonly state: any;
	readonly images: docker.Image[];
	readonly archive: stream.Readable;
}

export async function readUpdateBundle(
	input: stream.Readable,
): Promise<ReadableUpdateBundle> {
	const bundle = await read<UpdateBundleManifest>(input, BALENA_UPDATE_TYPE);

	const { state, images } = bundle.manifest;

	const archive = new docker.DockerArchive(images);

	for (const resource of bundle.resources) {
		if (archive.containsImageBlob(resource)) {
			archive.addImageBlob(resource);
			continue;
		}
		throw new Error(`Found unexpected resource in bundle: ${resource.id}`);
	}

	return { state, images, archive: archive.finalize() };
}
