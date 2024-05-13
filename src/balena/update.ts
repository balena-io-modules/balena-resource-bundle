import * as stream from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { create } from '../index';
import {
	fetchManifestAndToken,
	fetchBlob,
	type RegistryCredentials,
	type DockerImageManifest,
} from '../docker';

export const BALENA_UPDATE_TYPE = 'io.balena.update@1';

export interface Image {
	registry: string;
	name: string;
	reference: string;
	auth?: RegistryCredentials;
}

export type UpdateImage = Omit<Image, 'auth'> & {
	manifest: DockerImageManifest;
};

export interface UpdateManifest {
	state: string;
	images: UpdateImage[];
}

class WritableUpdateBundle {
	private _stream: stream.PassThrough;

	constructor(
		private _images: Image[],
		private _targetState: any,
	) {
		this._stream = new stream.PassThrough();
	}

	get stream(): stream.Readable {
		return this._stream;
	}

	async resume() {
		const imageManifests: UpdateImage[] = [];
		const entries = [];
		const digests = new Set<string>();

		for (const image of this._images) {
			const endpoint = `https://${image.registry}/v2`;

			const [imageManifest, token] = await fetchManifestAndToken(
				endpoint,
				image.name,
				image.reference,
				image.auth,
			);

			imageManifests.push({
				registry: image.registry,
				name: image.name,
				reference: image.reference,
				manifest: imageManifest,
			});

			const blobs = [imageManifest.config, ...imageManifest.layers];

			for (const blob of blobs) {
				if (!digests.has(blob.digest)) {
					entries.push({
						blob,
						endpoint,
						name: image.name,
						token,
					});

					digests.add(blob.digest);
				}
			}
		}

		const resources = entries.map(({ blob }) => ({
			id: blob.digest,
			size: blob.size,
			digest: blob.digest,
			type: blob.mediaType,
		}));

		const scheduledDownloads = entries.map((entry) => ({
			endpoint: entry.endpoint,
			name: entry.name,
			digest: entry.blob.digest,
			token: entry.token,
		}));

		const writable = create<UpdateManifest>({
			type: BALENA_UPDATE_TYPE,
			manifest: {
				state: this._targetState,
				images: imageManifests,
			},
			resources,
		});

		const pipelinePromise = pipeline(writable.stream, this._stream);

		for (const download of scheduledDownloads) {
			const blob = await fetchBlob(
				download.endpoint,
				download.name,
				download.digest,
				download.token,
			);

			await writable.addResource(download.digest, blob);
		}

		await writable.finalize();

		await pipelinePromise;
	}
}

// TODO: convert arguments to `releaseId` when backend API is available
export function createUpdateBundle(
	images: Image[],
	targetState: any,
): WritableUpdateBundle {
	return new WritableUpdateBundle(images, targetState);
}
