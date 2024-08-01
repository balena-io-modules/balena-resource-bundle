import * as stream from 'node:stream';
import type * as streamWeb from 'node:stream/web';

import type { Image, ImageManifest } from './types';
import { getDefaultHeaders } from './registry';

import { streamToString } from '../utils';
import type { ReadableBundle } from '../readable';

export async function pushImages<T>(
	bundle: ReadableBundle<T>,
	registry: string,
) {
	const images = (bundle.manifest as { images: Image[] }).images;

	for (const { data, digest } of bundle.resources) {
		let originalDigestRepository = null;

		for (const { descriptor, manifest } of images) {
			const { repository } = descriptor;
			if (isDigestInImage(manifest, digest)) {
				const blobExists = await doesBlobExists(registry, repository, digest);

				if (blobExists) {
					data.resume();
					continue;
				}

				if (originalDigestRepository == null) {
					await pushBlob(registry, repository, data, digest);
					originalDigestRepository = repository;
				} else {
					await mountBlob(
						registry,
						originalDigestRepository,
						repository,
						digest,
					);
				}
			}
		}
	}

	for (const { descriptor, manifest, manifestBase64 } of images) {
		const { repository, reference } = descriptor;
		await publishManifest(
			registry,
			repository,
			reference,
			manifest,
			manifestBase64,
		);
	}
}

async function doesBlobExists(
	registry: string,
	repository: string,
	digest: string,
): Promise<boolean> {
	const url = `https://${registry}/v2/${repository}/blobs/${digest}`;
	const response = await fetch(url, {
		method: 'HEAD',
		headers: {
			...getDefaultHeaders(),
		},
	});

	if (response.ok) {
		return true;
	} else if (response.status === 404) {
		return false;
	} else {
		throw new Error(
			`Checking blob existence failed for ${url}: ${response.statusText}`,
		);
	}
}

async function initiateBlobUpload(
	registry: string,
	repository: string,
): Promise<string> {
	const url = `https://${registry}/v2/${repository}/blobs/uploads/`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			...getDefaultHeaders(),
		},
	});

	if (!response.ok) {
		throw new Error(
			`Initiating blob upload failed for ${url}: ${response.statusText}`,
		);
	}

	const uploadLocation = response.headers.get('location');

	if (uploadLocation == null) {
		throw new Error(
			`No location header when initiating blob upload for ${url}`,
		);
	}

	return uploadLocation;
}

async function uploadBlobStream(
	uploadLocation: string,
	blob: stream.Readable,
): Promise<string> {
	const response = await fetch(uploadLocation, {
		method: 'PATCH',
		headers: {
			...getDefaultHeaders(),
		},
		body: stream.Readable.toWeb(blob) as any,
		duplex: 'half',
	} as RequestInit);

	if (!response.ok) {
		throw new Error(
			`Uploading blob stream failed for ${uploadLocation}: ${response.statusText}`,
		);
	}

	const completeUploadLocation = response.headers.get('location');

	if (completeUploadLocation == null) {
		throw new Error(
			`No location header when uploading blob stream for ${uploadLocation}`,
		);
	}

	return completeUploadLocation;
}

async function completeBlobUpload(
	completeUploadLocation: string,
	digest: string,
) {
	const url = new URL(completeUploadLocation);
	const params = url.searchParams;
	params.append('digest', digest);

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			...getDefaultHeaders(),
		},
	});

	if (!response.ok) {
		throw new Error(
			`Completing blob upload failed for ${url}: ${response.statusText}`,
		);
	}
}

async function pushBlob(
	registry: string,
	repository: string,
	blob: stream.Readable,
	digest: string,
) {
	const uploadLocation = await initiateBlobUpload(registry, repository);

	const completeUploadLocation = await uploadBlobStream(uploadLocation, blob);

	await completeBlobUpload(completeUploadLocation, digest);
}

async function mountBlob(
	registry: string,
	sourceRepository: string,
	targetRepository: string,
	digest: string,
) {
	const url = `https://${registry}/v2/${targetRepository}/blobs/uploads/?mount=${digest}&from=${sourceRepository}`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			...getDefaultHeaders(),
		},
	});

	if (!response.ok) {
		throw new Error(`Mounting blob failed for ${url}: ${response.statusText}`);
	}
}

async function publishManifest(
	registry: string,
	repository: string,
	reference: string,
	manifest: ImageManifest,
	manifestBase64: string,
) {
	const url = `https://${registry}/v2/${repository}/manifests/${reference}`;

	const manifestBody = Buffer.from(manifestBase64, 'base64');

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'Content-Type': manifest.mediaType,
			...getDefaultHeaders(),
		},
		body: manifestBody,
	});

	if (!response.ok) {
		if (response.body == null) {
			throw new Error(
				`Publish manifest failed for ${url}: ${response.statusText}`,
			);
		} else {
			const body = await streamToString(
				stream.Readable.fromWeb(response.body as streamWeb.ReadableStream),
			);

			throw new Error(`Publish manifest failed for ${url}: ${body}`);
		}
	}
}

function isDigestInImage(manifest: ImageManifest, digest: string): boolean {
	if (manifest.config.digest === digest) {
		return true;
	}

	for (const layer of manifest.layers) {
		if (layer.digest === digest) {
			return true;
		}
	}

	return false;
}
