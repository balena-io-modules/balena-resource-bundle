import type * as stream from 'node:stream';

import {
	BALENA_UPDATE_TYPE,
	open,
	type ReadableBundle,
	DockerArchive,
} from '../index';

export class UpdateBundleToDockerConverter {
	private _bundle: ReadableBundle<any>;
	private _dockerArchive: DockerArchive;

	constructor(input: stream.Readable) {
		const bundle = open(input, BALENA_UPDATE_TYPE);

		this._bundle = bundle;
		this._dockerArchive = new DockerArchive();
	}

	public get stream(): stream.Readable {
		return this._dockerArchive.stream;
	}

	public async init() {
		const manifest = await this._bundle.manifest();

		this._dockerArchive.init(manifest.images);
	}

	public async resume() {
		for await (const { resource, descriptor } of this._bundle.resources()) {
			await this._dockerArchive.addBlob(resource, descriptor);
		}

		this._dockerArchive.finalize();
	}
}

export async function convertUpdateBundleToDocker(
	input: stream.Readable,
): Promise<UpdateBundleToDockerConverter> {
	const converter = new UpdateBundleToDockerConverter(input);

	await converter.init();

	return converter;
}
