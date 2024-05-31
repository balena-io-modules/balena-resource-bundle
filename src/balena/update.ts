import * as stream from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { DockerImage, Image } from '../index';
import { create, DockerImageBundle } from '../index';

export const BALENA_UPDATE_TYPE = 'io.balena.update@1';

export interface UpdateManifest {
	state: string;
	images: DockerImage[];
}

class WritableUpdateBundle {
	private _stream: stream.PassThrough;
	private _dockerBundle: DockerImageBundle;
	private _targetState: any;
	constructor(images: Image[], targetState: any) {
		this._stream = new stream.PassThrough();
		this._dockerBundle = new DockerImageBundle(images);
		this._targetState = targetState;
	}

	get stream(): stream.Readable {
		return this._stream;
	}

	async resume() {
		await this._dockerBundle.fetchManifestsAndTokens();

		const writable = create<UpdateManifest>({
			type: BALENA_UPDATE_TYPE,
			manifest: {
				state: this._targetState,
				images: this._dockerBundle.imageManifests,
			},
			resources: this._dockerBundle.resources,
		});

		const pipelinePromise = pipeline(writable.stream, this._stream);

		await this._dockerBundle.fetchBlobs(writable);

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
