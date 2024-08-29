import * as stream from 'node:stream';
import * as tar from 'tar-stream';

import type { Credentials } from './registry';
import {
	authenticate,
	blobExists,
	discoverAuthenticate,
	fetchImageBlob,
	fetchImageManifest,
	mountBlob,
	parseImageName,
	publishManifest,
	pushBlob,
	unparseImageName,
} from './registry';
import type { ImageDescriptor, ImageManifest } from './types';
import type {
	BundleConvertible,
	ReadableBundle,
	WritableResource,
} from '../types';
import { scheduleResources, toPrettyJSON } from '../utils';

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

	private constructor(images: Image[], blobs: WritableResource[]) {
		this._images = images;
		this._blobs = blobs;
	}

	public get images(): ImageDescriptor[] {
		return this._images.map(({ descriptor }) => descriptor);
	}

	public tag(
		image: ImageDescriptor,
		nameOrDescriptor: string | ImageDescriptor,
	): ImageDescriptor {
		let newImage: ImageDescriptor;

		if (typeof nameOrDescriptor === 'string') {
			newImage = parseImageName(nameOrDescriptor);
		} else {
			newImage = nameOrDescriptor;
		}
		if (newImage.reference === 'latest') {
			newImage.reference = image.reference;
		}

		const imageIndex = this._images.findIndex(
			({ descriptor }) =>
				descriptor.registry === image.registry &&
				descriptor.repository === image.repository &&
				descriptor.reference === image.reference,
		);
		if (imageIndex === -1) {
			throw new Error(
				`Cannot tag image ${unparseImageName(image)}; image not found`,
			);
		}

		this._images[imageIndex].descriptor = newImage;

		return newImage;
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

				const entry = pack.entry({ name, size });

				entry.on('error', next);

				stream.pipeline(data, entry, (err) => {
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

	public async push(tokenOrCreds?: string | Credentials): Promise<void> {
		let token: string | undefined;

		// figure out auth

		if (tokenOrCreds != null) {
			if (!isSameRegistry(this.images)) {
				// Prevent leaking tokens to third-parties unintentionally
				throw new Error(
					'Refusing to push images to multiple registries using the same token',
				);
			}

			if (typeof tokenOrCreds === 'string') {
				token = tokenOrCreds;
			} else {
				const { auth } = await discoverAuthenticate(this.images, [
					'pull',
					'push',
				]);
				if (auth != null) {
					token = await authenticate(auth, tokenOrCreds);
				}
			}
		}

		// upload blobs

		await new Promise<void>((resolve, reject) => {
			scheduleResources(
				this._blobs.values(),
				async ({ digest }, data, next) => {
					data.on('error', next);
					try {
						await uploadLayer(this._images, digest, data, token);
					} catch (err) {
						data.destroy(err);
						next(err);
						return;
					}
					next();
				},
				(err) => {
					if (err != null) {
						reject(err);
					} else {
						resolve();
					}
				},
			);
		});

		// publish images

		await Promise.all(
			this._images.map(async (image) => {
				await publishManifest(
					image.descriptor,
					image.manifest.mediaType,
					// keeping the original manifest around ensures the pushed
					// image can be referenced using the same exact digest as
					// the original
					Buffer.from(image.manifestBase64, 'base64'),
					token,
				);
			}),
		);
	}

	public get contents() {
		return {
			type: IMAGE_SET_BUNDLE_TYPE,
			manifest: this._images,
			resources: this._blobs,
		};
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

	public static getImageDescriptor(name: string): ImageDescriptor {
		return parseImageName(name);
	}

	public static getImageName(image: ImageDescriptor): string {
		return unparseImageName(image);
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
		tokenOrCreds?: string | Credentials,
	): Promise<ImageSet> {
		// normalize arguments

		let descriptors: ImageDescriptor[];
		if (typeof namesOrDescriptors[0] === 'string') {
			descriptors = (namesOrDescriptors as string[]).map(parseImageName);
		} else {
			descriptors = namesOrDescriptors as any;
		}
		descriptors.forEach((descriptor) => {
			if (descriptor.reference === 'latest') {
				const name = unparseImageName(descriptor);
				throw new Error(
					`Expected image name '${name}' to include digest; only [domain.tld/][repo/image][@digest] format is supported`,
				);
			}
		});

		// figure out auth

		let token: string | undefined;

		if (tokenOrCreds != null) {
			if (!isSameRegistry(descriptors)) {
				// Prevent leaking tokens to third-parties unintentionally
				throw new Error(
					'Refusing to fetch images from multiple registries using the same token',
				);
			}

			if (typeof tokenOrCreds === 'string') {
				token = tokenOrCreds;
			} else {
				const { auth } = await discoverAuthenticate(descriptors, ['pull']);
				if (auth != null) {
					token = await authenticate(auth, tokenOrCreds);
				}
			}
		}

		// reach out to the registry to fetch info for the images

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
						// only include each blob once
						continue;
					}
					digests.add(blob.digest);

					blobs.push({
						id: blob.digest,
						size: blob.size,
						digest: blob.digest,
						type: blob.mediaType,
						// lazily fetch layer data
						data: async () => await fetchImageBlob(image, blob.digest, token),
					});
				}
			}),
		);

		return new ImageSet(images, blobs);
	}
}

function isSameRegistry(descriptors: ImageDescriptor[]): boolean {
	const registries = new Set<string>();
	descriptors.forEach(({ registry }) => registries.add(registry));
	return registries.size === 1;
}

function containsDigest(manifest: ImageManifest, digest: string): boolean {
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

async function uploadLayer(
	images: Image[],
	digest: string,
	data: stream.Readable,
	token?: string,
): Promise<void> {
	let mountFrom = null;

	for (const { descriptor, manifest } of images) {
		const { registry, repository } = descriptor;

		if (!containsDigest(manifest, digest)) {
			// blob is not contained in this image; move on
			continue;
		}

		if (await blobExists(registry, repository, digest, token)) {
			// blob already exists; move on
			continue;
		}

		if (mountFrom == null) {
			// Only upload a blob once, then mount from the same repository
			mountFrom = repository;
			await pushBlob(registry, repository, data, digest, token);
		} else {
			await mountBlob(registry, mountFrom, repository, digest, token);
		}
	}

	if (mountFrom == null) {
		// we didn't make use of the data; drain the stream
		data.resume();
	}
}
