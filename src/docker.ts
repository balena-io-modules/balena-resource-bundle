import * as stream from 'node:stream';
import { type ReadableStream } from 'node:stream/web';

import * as authenticate from 'auth-header';

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
