import * as stream from 'node:stream';
import { parse } from 'auth-header';

import type { ImageDescriptor, ImageManifest } from './types';
import { streamToString } from '../utils';

export type BasicAuth = {
	scheme: 'Basic';
	username: string;
	password: string;
};

export type BearerAuth = {
	scheme: 'Bearer';
	subject: string;
	token: string;
};

export type Credentials = BasicAuth | BearerAuth;

export function isBearerAuth(creds: Credentials): creds is BearerAuth {
	return creds.scheme === 'Bearer' && 'subject' in creds && 'token' in creds;
}

export type Authenticate = {
	realm: string;
	service: string;
	scopes: string[]; // eg. ['<repo1>:pull,push', '<repo2>:pull', ...]
};

type AuthenticateResult = {
	images: ImageDescriptor[];
	auth?: Authenticate;
};

/**
 * Given a list of images, queries the registry for info about how to authenticate.
 *
 * All images must be from the same registry.
 */
export async function discoverAuthenticate(
	imageNamesOrDescriptors: string[] | ImageDescriptor[],
	scopesToInclude: Array<'pull' | 'push'> = ['pull'],
): Promise<AuthenticateResult> {
	let images: ImageDescriptor[];
	if (typeof imageNamesOrDescriptors[0] === 'string') {
		images = (imageNamesOrDescriptors as string[]).map(parseImageName);
	} else {
		images = imageNamesOrDescriptors as any;
	}

	const registries = new Set<string>();
	images.forEach(({ registry }) => registries.add(registry));
	if (registries.size > 1) {
		throw new Error('All images must be of the same registry');
	}

	let auth: Authenticate | undefined;

	await Promise.all(
		images.map(async ({ registry, repository, reference }) => {
			const url = `https://${registry}/v2/${repository}/manifests/${reference}`;

			const res = await fetch(url, {
				method: 'HEAD',
				headers: getDefaultHeaders(undefined),
			});

			if (res.ok) {
				return;
			}

			const authHeader = res.headers.get('www-authenticate');

			if (authHeader == null) {
				throw new Error(
					`No 'www-authenticate' header present: ${res.status} ${res.statusText}`,
				);
			}
			const {
				params: { realm, service, scope },
			} = parse(authHeader);

			if (typeof realm !== 'string') {
				throw new Error(`Authenticate realm not a string ${realm}`);
			}
			if (typeof service !== 'string') {
				throw new Error(`Authenticate service not a string ${service}`);
			}
			if (typeof scope !== 'string') {
				throw new Error(`Authenticate scope not a string ${scope}`);
			}

			if (auth == null) {
				auth = { realm, service, scopes: [] };
			}

			if (auth.realm !== realm || auth.service !== service) {
				throw new Error('Unexpected authenticate header');
			}

			auth.scopes.push(scope);
		}),
	);

	if (auth != null) {
		auth.scopes = auth.scopes.map((scope) => {
			const parts = scope.split(':');

			// this assumes scope always ends with `:some-perm`
			const perms = new Set(parts.pop()!.split(','));
			scopesToInclude.forEach((s) => perms.add(s));

			return `${parts.join(':')}:${Array.from(perms).join(',')}`;
		});
	}

	return { images, auth };
}

/**
 * @returns a JWT appropriate for authorizing access to the images specified by auth.scope.
 */
export async function authenticate(
	auth: Authenticate,
	creds?: Credentials,
): Promise<string> {
	const url = new URL(auth.realm);
	const headers: Record<string, string> = {};

	if (creds != null) {
		let subject: string;
		let authToken: string;

		switch (creds.scheme) {
			case 'Basic':
				subject = creds.username;
				authToken = Buffer.from(`${subject}:${creds.password}`).toString(
					'base64',
				);
				break;
			case 'Bearer':
				subject = creds.subject;
				authToken = creds.token;
				break;
		}

		url.searchParams.append('account', subject);
		headers['Authorization'] = `${creds.scheme} ${authToken}`;
	}

	url.searchParams.append('service', auth.service);
	for (const scope of auth.scopes) {
		url.searchParams.append('scope', scope);
	}

	const response = await fetch(url, { headers });

	if (!response.ok) {
		throw new Error(
			`Failed to authenticate: ${response.status} ${response.statusText}`,
		);
	}

	const { token } = await response.json();

	if (token == null) {
		throw new Error('No token in authentication response');
	}

	return token;
}

// Internal

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

export function parseImageName(name: string): ImageDescriptor {
	// Matches (registry)/(repo)(optional :tag or @digest)
	// regex adapted from Docker's source code:
	// https://github.com/docker/distribution/blob/release/2.7/reference/normalize.go#L62
	// https://github.com/docker/distribution/blob/release/2.7/reference/regexp.go#L44
	const match = name.match(
		/^(?:(localhost|.*?[.:].*?)\/)?(.+?)(?::(.*?))?(?:@(.*?))?$/,
	);
	if (match == null) {
		throw new Error(`Could not parse image name: ${name}`);
	}
	const registry = match[match.length - 4];
	const repository = match[match.length - 3];
	if (repository == null) {
		throw new Error(
			`Invalid image name '${name}'; expected [domain.tld/]repo/image[:tag][@digest] format`,
		);
	}

	let reference: string;
	const tag = match[match.length - 2];
	const digest = match[match.length - 1];
	if (digest == null && tag == null) {
		reference = 'latest';
	} else if (digest != null) {
		if (
			!digest.match(
				/^[A-Za-z][A-Za-z0-9]*(?:[-_+.][A-Za-z][A-Za-z0-9]*)*:[0-9a-f-A-F]{32,}$/,
			)
		) {
			throw new Error(`Invalid digest format: ${digest}`);
		}
		reference = digest;
	} else {
		reference = tag;
	}

	return { registry, repository, reference };
}

export function unparseImageName(image: ImageDescriptor): string {
	const { registry, repository, reference } = image;
	const sep = reference.startsWith('sha256:') ? '@' : ':';
	return `${registry}/${repository}${sep}${reference}`;
}

const ACCEPTED_MANIFEST_TYPES = [
	'application/vnd.oci.image.manifest.v1+json',
	'application/vnd.docker.distribution.manifest.v2+json',
];

// pull

export async function fetchImageManifest(
	image: ImageDescriptor,
	token?: string,
): Promise<[ImageManifest, string]> {
	const url = `https://${image.registry}/v2/${image.repository}/manifests/${image.reference}`;

	const headers = new Headers([
		...Object.entries(getDefaultHeaders(token)),
		...ACCEPTED_MANIFEST_TYPES.map((type): [string, string] => [
			'Accept',
			type,
		]),
	]);

	const res = await fetch(url, { headers });

	if (!res.ok) {
		throw new Error(
			`Failed to fetch manifest: ${res.status} ${res.statusText}`,
		);
	}

	const manifestText = await res.text();
	const manifestBase64 = Buffer.from(manifestText).toString('base64');
	const manifest: ImageManifest = JSON.parse(manifestText);

	if (manifest.schemaVersion !== 2) {
		throw new Error(
			`Unexpected manifest schema version ${manifest.schemaVersion} (${unparseImageName(image)})`,
		);
	}

	if (!ACCEPTED_MANIFEST_TYPES.includes(manifest.mediaType)) {
		throw new Error(
			`Unexpected manifest media type ${manifest.mediaType} (${unparseImageName(image)})`,
		);
	}

	return [manifest, manifestBase64];
}

export async function fetchImageBlob(
	image: ImageDescriptor,
	digest: string,
	token?: string,
): Promise<stream.Readable> {
	const url = `https://${image.registry}/v2/${image.repository}/blobs/${digest}`;

	const res = await fetch(url, {
		headers: getDefaultHeaders(token),
	});

	if (!res.ok) {
		throw new Error(
			`Failed to fetch blob ${digest} from ${unparseImageName(image)}; ${res.status} ${res.statusText}`,
		);
	}
	if (res.body == null) {
		throw new Error('Response contains no body');
	}

	return stream.Readable.fromWeb(res.body as any);
}

// push

export async function blobExists(
	registry: string,
	repository: string,
	digest: string,
	token?: string,
): Promise<boolean> {
	const url = `https://${registry}/v2/${repository}/blobs/${digest}`;
	const response = await fetch(url, {
		method: 'HEAD',
		headers: {
			...getDefaultHeaders(token),
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
	token?: string,
): Promise<string> {
	const url = `https://${registry}/v2/${repository}/blobs/uploads/`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			...getDefaultHeaders(token),
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
	token?: string,
): Promise<string> {
	const response = await fetch(uploadLocation, {
		method: 'PATCH',
		headers: {
			...getDefaultHeaders(token),
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
	token?: string,
) {
	const url = new URL(completeUploadLocation);
	const params = url.searchParams;
	params.append('digest', digest);

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			...getDefaultHeaders(token),
		},
	});

	if (!response.ok) {
		throw new Error(
			`Completing blob upload failed for ${url}: ${response.statusText}`,
		);
	}
}

export async function pushBlob(
	registry: string,
	repository: string,
	blob: stream.Readable,
	digest: string,
	token?: string,
) {
	const uploadLocation = await initiateBlobUpload(registry, repository, token);

	const completeUploadLocation = await uploadBlobStream(
		uploadLocation,
		blob,
		token,
	);

	await completeBlobUpload(completeUploadLocation, digest, token);
}

export async function mountBlob(
	registry: string,
	sourceRepository: string,
	targetRepository: string,
	digest: string,
	token?: string,
) {
	const url = `https://${registry}/v2/${targetRepository}/blobs/uploads/?mount=${digest}&from=${sourceRepository}`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			...getDefaultHeaders(token),
		},
	});

	if (!response.ok) {
		throw new Error(`Mounting blob failed for ${url}: ${response.statusText}`);
	}
}

export async function publishManifest(
	image: ImageDescriptor,
	mediaType: string,
	manifest: Buffer,
	token?: string,
) {
	const url = `https://${image.registry}/v2/${image.repository}/manifests/${image.reference}`;

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			...getDefaultHeaders(token),
			'Content-Type': mediaType,
		},
		body: manifest,
	});

	if (!response.ok) {
		if (response.body == null) {
			throw new Error(
				`Publish manifest failed for ${url}: ${response.statusText}`,
			);
		} else {
			const body = await streamToString(
				stream.Readable.fromWeb(response.body as any),
			);

			throw new Error(`Publish manifest failed for ${url}: ${body}`);
		}
	}
}
