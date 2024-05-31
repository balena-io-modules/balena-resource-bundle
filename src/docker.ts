import * as stream from 'node:stream';
import { type ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

import * as tar from 'tar-stream';

import * as authenticate from 'auth-header';

import type { Resource, WritableBundle } from './index';
import { toPrettyJSON } from './writable';

export const DOCKER_IMAGE_ROOTFS_COMPRESSED =
	'application/vnd.docker.image.rootfs.diff.tar.gzip';
export const DOCKER_IMAGE_CONFIG =
	'application/vnd.docker.container.image.v1+json';
export const DOCKER_IMAGE_MANIFEST =
	'application/vnd.docker.distribution.manifest.v2+json';

export interface RegistryCredentials {
	username: string;
	password: string;
}

export interface Image {
	registry: string;
	name: string;
	reference: string;
	auth?: RegistryCredentials;
}

export interface DockerImageBlob {
	mediaType: string;
	size: number;
	digest: string;
}

export interface DockerImageManifest {
	schemaVersion: number;
	mediaType: string;
	config: DockerImageBlob;
	layers: [DockerImageBlob];
}

export type DockerImage = Omit<Image, 'auth'> & {
	manifest: DockerImageManifest;
};

interface ScheduledDownload {
	endpoint: string;
	name: string;
	digest: string;
	token: string | undefined;
}

async function getAuthToken(
	header: string,
	credentials: RegistryCredentials,
): Promise<string> {
	const token = authenticate.parse(header);

	const realm = token.params.realm;
	const service = token.params.service;
	const scope = token.params.scope;

	if (typeof realm !== 'string') {
		throw new Error(`Authenticate realm not a string ${realm}`);
	}

	if (typeof service !== 'string') {
		throw new Error(`Authenticate service not a string ${service}`);
	}

	if (typeof scope !== 'string') {
		throw new Error(`Authenticate scope not a string ${scope}`);
	}

	const url = new URL(realm);
	url.searchParams.append('account', credentials.username);
	url.searchParams.append('service', service);
	url.searchParams.append('scope', scope);

	const auth = btoa(`${credentials.username}:${credentials.password}`);

	const response = await fetch(url, {
		headers: {
			Authorization: `Basic ${auth}`,
		},
	});

	if (!response.ok) {
		throw new Error(
			`Failed to authenticate: ${response.status} ${response.statusText}`,
		);
	}

	const result = await response.json();

	if (result.token == null) {
		throw new Error('No token in authentication response');
	}

	return result.token;
}

function getDefaultHeaders(token?: string) {
	const auth =
		token == null
			? undefined
			: {
					Authorization: `Bearer ${token}`,
				};

	return {
		'Accept-Encoding': 'gzip',
		'Docker-Distribution-Api-Version': 'registry/2.0',
		...auth,
	};
}

async function fetchManifest(
	endpoint: string,
	name: string,
	reference: string,
	token?: string,
): Promise<Response> {
	const url = `${endpoint}/${name}/manifests/${reference}`;

	return await fetch(url, {
		headers: {
			...getDefaultHeaders(token),
			Accept: 'application/vnd.docker.distribution.manifest.v2+json',
		},
	});
}

export async function fetchManifestAndToken(
	endpoint: string,
	name: string,
	reference: string,
	credentials?: RegistryCredentials,
): Promise<[DockerImageManifest, string | undefined]> {
	let token;

	let response = await fetchManifest(endpoint, name, reference);

	if (!response.ok) {
		const authHeader = response.headers.get('www-authenticate');

		if (authHeader == null) {
			throw new Error(
				`No 'www-authenticate' header present: ${response.status} ${response.statusText}`,
			);
		}

		if (credentials == null) {
			throw new Error(
				'Authentication credentials are not provided, but token is necessary',
			);
		}

		token = await getAuthToken(authHeader, credentials);

		response = await fetchManifest(endpoint, name, reference, token);

		if (!response.ok) {
			throw new Error(
				`Failed to fetch manifest: ${response.status} ${response.statusText}`,
			);
		}
	}

	const manifest: DockerImageManifest = await response.json();

	if (manifest.schemaVersion !== 2) {
		throw new Error(
			`Unexpected manifest schema version ${manifest.schemaVersion} (${endpoint} ${name} ${reference})`,
		);
	}

	if (manifest.mediaType !== DOCKER_IMAGE_MANIFEST) {
		throw new Error(
			`Unexpected manifest media type ${manifest.mediaType} (${endpoint} ${name} ${reference})`,
		);
	}

	return [manifest, token];
}

export async function fetchBlob(
	registry: string,
	name: string,
	digest: string,
	token?: string,
): Promise<stream.Readable> {
	const url = `${registry}/${name}/blobs/${digest}`;

	const response = await fetch(url, {
		headers: getDefaultHeaders(token),
	});

	if (!response.ok) {
		throw new Error(
			`Fetching blob ${name}@${digest} failed: ${response.status} ${response.statusText}`,
		);
	}

	return stream.Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
}

export class DockerImageBundle {
	private _imageManifests: DockerImage[];
	private _resources: Resource[];
	private _scheduledDownloads: ScheduledDownload[];

	constructor(private _images: Image[]) {
		this._imageManifests = [];
	}

	public get imageManifests(): DockerImage[] {
		return this._imageManifests;
	}

	public get resources(): Resource[] {
		return this._resources;
	}

	async fetchManifestsAndTokens() {
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

			this._imageManifests.push({
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

		this._resources = entries.map(({ blob }) => ({
			id: blob.digest,
			size: blob.size,
			digest: blob.digest,
			type: blob.mediaType,
		}));

		this._scheduledDownloads = entries.map((entry) => ({
			endpoint: entry.endpoint,
			name: entry.name,
			digest: entry.blob.digest,
			token: entry.token,
		}));
	}

	async fetchBlobs<T>(writable: WritableBundle<T>) {
		for (const download of this._scheduledDownloads) {
			const blob = await fetchBlob(
				download.endpoint,
				download.name,
				download.digest,
				download.token,
			);

			await writable.addResource(download.digest, blob);
		}
	}
}

export class DockerArchive {
	private _pack: tar.Pack;

	constructor() {
		this._pack = tar.pack();
	}

	public get stream(): stream.Readable {
		return this._pack;
	}

	public init(images: DockerImage[]) {
		const repositories: { [repo: string]: { [ref: string]: string } } = {};
		const dockerManifests = [];
		for (const image of images) {
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

		this._pack.entry({ name: 'manifest.json' }, toPrettyJSON(dockerManifests));

		this._pack.entry({ name: 'repositories' }, toPrettyJSON(repositories));
	}

	public async addBlob(blob: stream.Readable, descriptor: Resource) {
		let name;
		if (descriptor.type === DOCKER_IMAGE_ROOTFS_COMPRESSED) {
			name = `${descriptor.digest}.tar.gz`;
		} else if (descriptor.type === DOCKER_IMAGE_CONFIG) {
			name = `${descriptor.digest.split(':')[1]}.json`;
		} else {
			throw new Error(`Unknown resource type ${descriptor.type}`);
		}

		const entry = this._pack.entry({ name: name, size: descriptor.size });
		await pipeline(blob, entry);
	}

	public finalize() {
		this._pack.finalize();
	}
}
