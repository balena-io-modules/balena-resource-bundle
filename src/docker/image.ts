import * as stream from 'node:stream';
import * as tar from 'tar-stream';

import {
	fetchImageBlob,
	fetchImageManifest,
	parseImageName,
	unparseImageName,
} from './registry';
import type { ImageDescriptor, ImageManifest } from './types';
import type {
	BundleConvertible,
	ReadableBundle,
	WritableResource,
} from '../types';
import { scheduleResources, toPrettyJSON } from '../utils';
import { Hasher } from '../hasher';

export const IMAGE_SET_BUNDLE_TYPE = 'io.balena.docker-image-set@1';

const DOCKER_IMAGE_ROOTFS_COMPRESSED =
	'application/vnd.docker.image.rootfs.diff.tar.gzip';
const DOCKER_IMAGE_CONFIG = 'application/vnd.docker.container.image.v1+json';

type Image = {
	descriptor: ImageDescriptor;
	manifest: ImageManifest;
	manifestBase64: string;
};

export type ImageSetManifest = Image[];

export class ImageSet
	implements BundleConvertible<ImageSetManifest, WritableResource>
{
	private _images: Image[];
	private _blobs: WritableResource[];

	private _manifests: Array<{
		Config: string;
		RepoTags: string[];
		Layers: string[];
	}>;

	private _repositories: {
		[repo: string]: { [ref: string]: string };
	};

	private constructor(images: ImageSetManifest, blobs: WritableResource[]) {
		this._images = images;
		this._blobs = blobs;

		this._manifests = [];
		this._repositories = {};

		for (const { manifest, descriptor } of images) {
			this._manifests.push({
				Config: `${manifest.config.digest.split(':')[1]}.json`,
				RepoTags: [`${descriptor.registry}/${descriptor.repository}:latest`],
				Layers: manifest.layers.map((layer) => `${layer.digest}.tar.gz`),
			});

			this._repositories[`${descriptor.registry}/${descriptor.repository}`] = {
				latest: `${descriptor.reference.split(':')[1]}`,
			};
		}
	}

	public get images(): ImageDescriptor[] {
		return this._images.map(({ descriptor }) => descriptor);
	}

	/**
	 * Creates a Docker image archive and returns a stream that can be piped
	 * directly to `docker load`.
	 */
	public pack(): stream.Readable {
		const out = new stream.PassThrough();

		const { _blobs: blobs } = this;

		const pack = tar.pack();
		pack.on('error', (err) => {
			if (err != null) {
				out.destroy(err);
			}
		});

		pack.entry(
			{ name: 'manifest.json' },
			toPrettyJSON(
				this._images.map(({ manifest, descriptor }) => ({
					Config: `${manifest.config.digest.split(':')[1]}.json`,
					RepoTags: [`${descriptor.registry}/${descriptor.repository}:latest`],
					Layers: manifest.layers.map((layer) => `${layer.digest}.tar.gz`),
				})),
			),
		);
		pack.entry(
			{ name: 'repositories' },
			toPrettyJSON(
				Object.fromEntries(
					this._images.map(({ descriptor }) => [
						`${descriptor.registry}/${descriptor.repository}`,
						{ latest: `${descriptor.reference.split(':')[1]}` },
					]),
				),
			),
		);

		scheduleResources(
			blobs.values(),
			(resource, data, next) => {
				const { type, size, digest } = resource;

				let name: string;
				if (type === DOCKER_IMAGE_ROOTFS_COMPRESSED) {
					name = `${digest}.tar.gz`;
				} else if (type === DOCKER_IMAGE_CONFIG) {
					name = `${digest.split(':')[1]}.json`;
				} else {
					throw new Error(`Unknown resource type ${type}`);
				}

				const hasher = new Hasher(digest);
				const entry = pack.entry({ name, size });

				entry.on('error', next);

				stream.pipeline(data, hasher, entry, (err) => {
					if (err != null) {
						next(err);
					} else {
						next();
					}
				});
			},
			(err) => {
				if (err != null) {
					pack.destroy(err);
				} else {
					pack.finalize();
				}
			},
		);

		stream.pipeline(pack, out, (err) => {
			if (err != null) {
				out.destroy(err);
			}
		});

		return out;
	}

	public get contents() {
		return {
			type: IMAGE_SET_BUNDLE_TYPE,
			manifest: this._images,
			resources: this._blobs,
		};
	}

	/**
	 * Pull the given images, ensuring shared layers are only included once.
	 * If a token is provided, all images must be from the same registry.
	 *
	 * Fetching blob data is deferred until the returned `ImageSet` is
	 * actually used further (eg. to create a Docker archive or resource bundle).
	 *
	 * @param image an array of descriptors for the images to fetch
	 * @param token (optional) a JWT that authorizes access to the images
	 */
	public static async fromImages(
		namesOrDescriptors: string[] | ImageDescriptor[],
		token?: string,
	): Promise<ImageSet> {
		let descriptors: ImageDescriptor[];
		if (typeof namesOrDescriptors[0] === 'string') {
			descriptors = (namesOrDescriptors as string[]).map(parseImageName);
		} else {
			descriptors = namesOrDescriptors as any;
		}

		if (token != null) {
			const registries = new Set<string>();
			descriptors.forEach(({ registry }) => registries.add(registry));
			if (registries.size > 1) {
				// Prevent leaking tokens to third-parties unintentionally
				throw new Error(
					'Refusing to fetch images from multiple registries using the same token',
				);
			}
		}

		descriptors.forEach((descriptor) => {
			if (descriptor.reference === 'latest') {
				const name = unparseImageName(descriptor);
				throw new Error(
					`Expected image name '${name}' to include digest; only [domain.tld/][repo/image][@digest] format is supported`,
				);
			}
		});

		const images: Image[] = [];
		const blobs: WritableResource[] = [];

		const digests = new Set<string>();

		await Promise.all(
			descriptors.map(async (image) => {
				const [manifest, manifestBase64] = await fetchImageManifest(
					image,
					token,
				);

				images.push({ descriptor: image, manifest, manifestBase64 });

				for (const blob of [manifest.config, ...manifest.layers]) {
					if (digests.has(blob.digest)) {
						continue;
					}
					digests.add(blob.digest);

					blobs.push({
						id: blob.digest,
						size: blob.size,
						digest: blob.digest,
						type: blob.mediaType,
						// lazily fetch blob
						data: async () => await fetchImageBlob(image, blob.digest, token),
					});
				}
			}),
		);

		return new ImageSet(images, blobs);
	}

	public static fromBundle(bundle: ReadableBundle<ImageSetManifest>) {
		if (bundle.type !== IMAGE_SET_BUNDLE_TYPE) {
			throw new Error(
				`Not an image set bundle; invalid bundle type: ${bundle.type}`,
			);
		}

		return new ImageSet(
			bundle.manifest,
			bundle.resources.map((resource) => bundle.read(resource)),
		);
	}
}
