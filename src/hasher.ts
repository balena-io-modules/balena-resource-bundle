import * as stream from 'node:stream';
import * as crypto from 'node:crypto';

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

		// The streams pipeline API attaches a lot of listeners and that may trigger
		// a false warning about possible memory leak, so we increase the maximum
		// allowed listeners count to silence it. 100 is a reasonable number.
		this.setMaxListeners(100);

		const [algorithm, checksum] = digest.split(':');

		if (checksum == null) {
			throw new Error(`Malformed digest ${digest}`);
		}

		this._digest = digest;
		this._algorithm = algorithm;
		this._checksum = checksum;

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
