import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import { generateKeyPairSync } from 'node:crypto';

import * as bundle from '../src';

chai.use(chaiAsPromised);
const expect = chai.expect;

/*
Keys are generated with:

generateKeyPairSync('ec', {
	namedCurve: 'sect239k1',
	publicKeyEncoding: {
		type: 'spki',
		format: 'pem',
	},
	privateKeyEncoding: {
		type: 'pkcs8',
		format: 'pem',
	},
});
*/

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MH4CAQAwEAYHKoZIzj0CAQYFK4EEAAMEZzBlAgEBBB4a5reTVinz6z1vAB/5zT4h
oj/21eS6XNefuIJcKeOhQAM+AAQfY65NaMLR/dDKHiRfas4uqMuBg6TwCDDdF9z7
PwdANlZqZN/4BB3SrdumyCduFWbXeCxM8byidO6Qu7k=
-----END PRIVATE KEY-----
`;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFIwEAYHKoZIzj0CAQYFK4EEAAMDPgAEH2OuTWjC0f3Qyh4kX2rOLqjLgYOk8Agw
3Rfc+z8HQDZWamTf+AQd0q3bpsgnbhVm13gsTPG8onTukLu5
-----END PUBLIC KEY-----
`;

describe('signing tests', () => {
	it('create a signed bundle and read it with public key', async () => {
		const writableStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: bundle.stringToStream('hello'),
				},
			],
			sign: {
				privateKey: PRIVATE_KEY,
			},
		});

		const readable = await bundle.read(writableStream, 'foo@1', PUBLIC_KEY);
		const manifest = readable.manifest;

		expect(manifest).to.eql(['hello.txt']);
	});

	it('create a signed bundle but read it without a public key', async () => {
		const writableStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: bundle.stringToStream('hello'),
				},
			],
			sign: {
				privateKey: PRIVATE_KEY,
			},
		});

		try {
			await bundle.read(writableStream, 'foo@1');
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Signed bundle requires a public key to be provided',
			);
		}
	});

	it('create a signed bundle but read it with unsupported public key', async () => {
		const writableStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: bundle.stringToStream('hello'),
				},
			],
			sign: {
				privateKey: PRIVATE_KEY,
			},
		});

		try {
			await bundle.read(writableStream, 'foo@1', 'BAD KEY');
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.contain('unsupported');
		}
	});

	it('create a signed bundle but read it with wrong public key', async () => {
		const writableStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: bundle.stringToStream('hello'),
				},
			],
			sign: {
				privateKey: PRIVATE_KEY,
			},
		});

		const { publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'sect239k1',
			publicKeyEncoding: {
				type: 'spki',
				format: 'pem',
			},
			privateKeyEncoding: {
				type: 'pkcs8',
				format: 'pem',
			},
		});

		try {
			await bundle.read(writableStream, 'foo@1', publicKey);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('contents.json has invalid signature');
		}
	});

	it('try signing bundle with a bad private key', async () => {
		try {
			bundle.create({
				type: 'foo@1',
				manifest: ['hello.txt'],
				resources: [
					{
						id: 'hello',
						size: 5,
						digest:
							'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
						data: bundle.stringToStream('hello'),
					},
				],
				sign: {
					privateKey: 'BAD KEY',
				},
			});

			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.contain('unsupported');
		}
	});
});
