import * as stream from 'node:stream';
import * as crypto from 'node:crypto';

// TODO: Separately test the hasher as well - this may repeat some tests

export function sha256sum(contents: string): string {
	const hash = crypto.createHash('sha256');

	hash.update(contents);

	return hash.digest('hex');
}

export class Hasher extends stream.PassThrough {
	private _digest: string;
	private _algorithm: string;
	private _checksum: string;

	constructor(digest: string) {
		super();

		// TODO: Validate the parse result
		const [algorithm, checksum] = digest.split(':');
		this._digest = digest;
		this._algorithm = algorithm;
		this._checksum = checksum;

		// TODO: Test with unknown algorithm
		const hash = crypto.createHash(algorithm);

		this.on('data', (chunk) => hash.update(chunk));

		this.on('end', () => {
			const calculatedChecksum = hash.digest('hex');
			if (checksum !== calculatedChecksum) {
				this.emit(
					'error',
					new Error(
						`Expected digest ${digest} does not match calculated digest ${algorithm}:${calculatedChecksum}`,
					),
				);
			}
		});
	}

	get digest(): string {
		return this._digest;
	}

	get algorithm(): string {
		return this._algorithm;
	}

	get checksum(): string {
		return this._checksum;
	}
}
