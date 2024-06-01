import * as stream from 'node:stream';

import { parse } from 'auth-header';

import type { Image, ImageDescriptor, ImageManifest, ImageBlob } from './types';
import type { Resource } from '../types';

export interface Authenticate {
	realm: string;
	service: string;
	scope: string[]; // eg. [ '<repo1>:pull,push', '<repo2>:pull' ]
}

/**
 * @param header the www-authenticate header from a 401 registry response.
 */
export function parseAuthenticateHeader(header: string): Authenticate {
	let {
		params: { realm, service, scope },
	} = parse(header);

	if (typeof realm !== 'string') {
		throw new Error(`Authenticate realm not a string ${realm}`);
	}
	if (typeof service !== 'string') {
		throw new Error(`Authenticate service not a string ${service}`);
	}
	if (!Array.isArray(scope)) {
		scope = [scope];
	}

	return { realm, service, scope };
}

export interface Credentials {
	username: string;
	password: string;
}

/**
 * @returns a JWT appropriate for authorizing access to the images specified by auth.scope.
 */
export async function authenticate(
	auth: Authenticate,
	creds: Credentials,
): Promise<string> {
	const url = new URL(auth.realm);
	url.searchParams.append('account', creds.username);
	url.searchParams.append('service', auth.service);
	for (const scope of auth.scope) {
		url.searchParams.append('scope', scope);
	}

	const b64auth = Buffer.from(`${creds.username}:${creds.password}`).toString(
		'base64',
	);

	const response = await fetch(url, {
		headers: {
			Authorization: `Basic ${b64auth}`,
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

function unparseImageName(image: ImageDescriptor): string {
	const { registry, repository, reference } = image;
	const sep = reference.startsWith('sha256:') ? '@' : ':';
	return `${registry}/${repository}${sep}${reference}`;
}

/**
 *
 * @param image a descriptor for the image to fetch
 * @param token (optional) a JWT that authorizes access to the image
 */
export async function fetchImage(
	image: ImageDescriptor,
	token?: string,
): Promise<{
	image: Image;
	blobs: Resource[];
}> {
	const manifest = await fetchImageManifest(image, token);

	const blobs = [manifest.config, ...manifest.layers];
	const digests = new Set<string>();
	const resources = new Array<Resource>();

	for (const blob of blobs) {
		if (digests.has(blob.digest)) {
			continue;
		}
		digests.add(blob.digest);

		resources.push({
			id: blob.digest,
			size: blob.size,
			digest: blob.digest,
			type: blob.mediaType,
			data: await fetchImageBlob(image, blob, token),
		});
	}

	return { image: { descriptor: image, manifest }, blobs: resources };
}

function getDefaultHeaders(token?: string): { [name: string]: string } {
	const headers: any = {
		'Accept-Encoding': 'gzip',
		'Docker-Distribution-Api-Version': 'registry/2.0',
	};
	if (token != null) {
		headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
}

async function fetchImageManifest(
	image: ImageDescriptor,
	token?: string,
): Promise<ImageManifest> {
	const url = `http://${image.registry}/v2/${image.repository}/manifests/${image.reference}`;

	const res = await fetch(url, {
		headers: {
			...getDefaultHeaders(token),
			Accept: 'application/vnd.docker.distribution.manifest.v2+json',
		},
	});

	if (!res.ok) {
		throw new Error(
			`Failed to fetch manifest: ${res.status} ${res.statusText}`,
		);
	}

	const manifest: ImageManifest = await res.json();

	if (manifest.schemaVersion !== 2) {
		throw new Error(
			`Unexpected manifest schema version ${manifest.schemaVersion} (${unparseImageName(image)})`,
		);
	}

	if (
		manifest.mediaType !==
		'application/vnd.docker.distribution.manifest.v2+json'
	) {
		throw new Error(
			`Unexpected manifest media type ${manifest.mediaType} (${unparseImageName(image)})`,
		);
	}

	return manifest;
}

async function fetchImageBlob(
	image: ImageDescriptor,
	blob: ImageBlob,
	token?: string,
): Promise<stream.Readable> {
	const url = `https://${image.registry}/v2/${image.repository}/blobs/${blob.digest}`;

	const res = await fetch(url, {
		headers: getDefaultHeaders(token),
	});

	if (!res.ok) {
		throw new Error(
			`Failed to fetch blob ${blob.digest} from ${unparseImageName(image)}; ${res.status} ${res.statusText}`,
		);
	}
	if (res.body == null) {
		throw new Error('Response contains no body');
	}

	return stream.Readable.fromWeb(res.body as any);
}
