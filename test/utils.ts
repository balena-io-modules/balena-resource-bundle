import * as stream from 'node:stream';
import * as tar from 'tar-stream';

import * as bundle from '../src';

import { sha256sum } from '../src/hasher';

export class ErroringStream extends stream.Readable {
	shouldError: boolean = false;

	constructor(private content: string) {
		super({ objectMode: false });
	}

	_read() {
		if (this.shouldError) {
			this.emit('error', new Error('ErroringStream is throwing an error'));
		} else {
			this.push(this.content);

			this.shouldError = true;
		}
	}
}

export function createTarBundle(contents) {
	const pack = tar.pack();

	const contentsJson = JSON.stringify(contents);

	pack.entry({ name: 'contents.json' }, contentsJson);

	const signature = {
		digest: sha256sum(contentsJson),
	};

	pack.entry({ name: 'contents.sig' }, JSON.stringify(signature));

	return pack;
}

export function createEmptyTestBundle(contents) {
	const pack = createTarBundle(contents);

	pack.finalize();

	const readable = bundle.open(pack, 'foo@1');

	return readable;
}

export async function streamToString(source: stream.Readable): Promise<string> {
	let str = '';

	return new Promise((resolve, reject) => {
		source.on('data', (data) => {
			str += data.toString();
		});

		source.on('end', () => resolve(str));

		source.on('error', reject);
	});
}

export function stringToStream(str: string): stream.Readable {
	return stream.Readable.from([str], { objectMode: false });
}

export function repeatedStringToStream(
	str: string,
	count: number,
): stream.Readable {
	function* generateRepeat() {
		for (let i = 0; i < count; i++) {
			yield str;
		}
	}
	return stream.Readable.from(generateRepeat(), { objectMode: false });
}
