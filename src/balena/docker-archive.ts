import type * as stream from 'node:stream';
import { pipeline } from 'node:stream/promises';

import * as tar from 'tar-stream';

import { BALENA_UPDATE_TYPE, open, type ReadableBundle } from '../index';

import { toPrettyJSON } from '../writable';
import { DOCKER_IMAGE_ROOTFS_COMPRESSED, DOCKER_IMAGE_CONFIG } from '../docker';

export class UpdateBundleToDockerConverter {
	private bundle: ReadableBundle<any>;
	private manifest: any;
	private pack: tar.Pack;

	constructor(input: stream.Readable) {
		const bundle = open(input, BALENA_UPDATE_TYPE);

		this.bundle = bundle;
		this.pack = tar.pack();
	}

	public get stream(): stream.Readable {
		return this.pack;
	}

	public async init() {
		const manifest = await this.bundle.manifest();

		this.manifest = manifest;
	}

	public async resume() {
		const repositories: { [repo: string]: { [ref: string]: string } } = {};
		const dockerManifests = [];
		for (const image of this.manifest.images) {
			const blobNames = image.manifest.layers.map(
				(layer: any) => `${layer.digest}.tar.gz`,
			);
			const configName = `${image.manifest.config.digest.split(':')[1]}.json`;
			const dockerManifest = {
				Config: configName,
				RepoTags: [`${image.registry}/${image.name}:latest`],
				Layers: blobNames,
			};
			dockerManifests.push(dockerManifest);

			repositories[`${image.registry}/${image.name}`] = {
				latest: `${image.reference.split(':')[1]}`,
			};
		}

		this.pack.entry({ name: 'manifest.json' }, toPrettyJSON(dockerManifests));

		this.pack.entry({ name: 'repositories' }, toPrettyJSON(repositories));

		for await (const { resource, descriptor } of this.bundle.resources()) {
			let name;
			if (descriptor.type === DOCKER_IMAGE_ROOTFS_COMPRESSED) {
				name = `${descriptor.digest}.tar.gz`;
			} else if (descriptor.type === DOCKER_IMAGE_CONFIG) {
				name = `${descriptor.digest.split(':')[1]}.json`;
			} else {
				throw new Error(`Unknown resource type ${descriptor.type}`);
			}

			const entry = this.pack.entry({ name: name, size: descriptor.size });
			await pipeline(resource, entry);
		}

		this.pack.finalize();
	}
}

export async function convertUpdateBundleToDocker(
	input: stream.Readable,
): Promise<UpdateBundleToDockerConverter> {
	const converter = new UpdateBundleToDockerConverter(input);

	await converter.init();

	return converter;
}
