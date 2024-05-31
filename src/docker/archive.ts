import * as stream from 'node:stream';
import * as tar from 'tar-stream';

import type { Image } from './types';
import type { Resource, ResourceDescriptor } from '../types';
import { toPrettyJSON } from '../utils';

const DOCKER_IMAGE_ROOTFS_COMPRESSED =
	'application/vnd.docker.image.rootfs.diff.tar.gzip';
const DOCKER_IMAGE_CONFIG = 'application/vnd.docker.container.image.v1+json';

interface DockerArchiveManifest {
	Config: string;
	RepoTags: string[];
	Layers: string[];
}

interface DockerArchiveRepositories {
	[repo: string]: { [ref: string]: string };
}

export class DockerArchive {
	public readonly images: Image[];

	private _blobs: Resource[];

	constructor(images: Image[]) {
		this.images = images;
		this._blobs = [];
	}

	public containsImageBlob(descriptor: ResourceDescriptor): boolean {
		return this.images.some((image) => {
			const { digest } = descriptor;
			const { manifest } = image;
			return (
				manifest.layers.some((blob) => blob.digest === digest) ||
				manifest.config.digest === digest
			);
		});
	}

	public addImageBlob(blob: Resource) {
		this._blobs.push(blob);
	}

	public finalize(): stream.Readable {
		const pack = tar.pack();

		const repositories: DockerArchiveRepositories = {};
		const manifests: DockerArchiveManifest[] = [];
		for (const { manifest, descriptor } of this.images) {
			const blobNames = manifest.layers.map(
				(layer: any) => `${layer.digest}.tar.gz`,
			);
			const configName = `${manifest.config.digest.split(':')[1]}.json`;
			manifests.push({
				Config: configName,
				RepoTags: [`${descriptor.registry}/${descriptor.repository}:latest`],
				Layers: blobNames,
			});

			repositories[`${descriptor.registry}/${descriptor.repository}`] = {
				latest: `${descriptor.reference.split(':')[1]}`,
			};
		}

		pack.entry({ name: 'manifest.json' }, toPrettyJSON(manifests));
		pack.entry({ name: 'repositories' }, toPrettyJSON(repositories));

		for (const blob of this._blobs) {
			let name;
			if (blob.type === DOCKER_IMAGE_ROOTFS_COMPRESSED) {
				name = `${blob.digest}.tar.gz`;
			} else if (blob.type === DOCKER_IMAGE_CONFIG) {
				name = `${blob.digest.split(':')[1]}.json`;
			} else {
				throw new Error(`Unknown resource type ${blob.type}`);
			}
			const entry = pack.entry({ name, size: blob.size });
			stream.pipeline(blob.data, entry, (err) => {
				if (err != null) {
					pack.emit('error', err);
				}
			});
		}

		pack.finalize();

		return pack;
	}
}
