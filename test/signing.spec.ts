import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as tar from 'tar-stream';
import * as stream from 'node:stream';

import { stringToStream } from './utils';
import * as bundle from '../src';
import * as signer from '../src/signer';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('signing tests', () => {
	it('create a signed bundle and then make sure it is signed', async () => {
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

		const privateKey = `-----BEGIN PRIVATE KEY-----
MH4CAQAwEAYHKoZIzj0CAQYFK4EEAAMEZzBlAgEBBB4a5reTVinz6z1vAB/5zT4h
oj/21eS6XNefuIJcKeOhQAM+AAQfY65NaMLR/dDKHiRfas4uqMuBg6TwCDDdF9z7
PwdANlZqZN/4BB3SrdumyCduFWbXeCxM8byidO6Qu7k=
-----END PRIVATE KEY-----
`;

		const publicKey = `-----BEGIN PUBLIC KEY-----
MFIwEAYHKoZIzj0CAQYFK4EEAAMDPgAEH2OuTWjC0f3Qyh4kX2rOLqjLgYOk8Agw
3Rfc+z8HQDZWamTf+AQd0q3bpsgnbhVm13gsTPG8onTukLu5
-----END PUBLIC KEY-----
`;

		const writable = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt', 'world.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
			sign: {
				privateKey,
			},
		});

		const hello = stringToStream('hello');
		await writable.addResource('hello', hello);

		await writable.finalize();

		const extract = tar.extract();

		stream.pipeline(writable.pack, extract, (err) => {
			if (err != null) {
				throw err;
			}
		});

		const iterator = extract[Symbol.asyncIterator]();

		const entry: tar.Entry = (await iterator.next()).value;
		const contentsRes = new Response(entry as any);
		const contentsStr = await contentsRes.text();

		const entrySig: tar.Entry = (await iterator.next()).value;

		const contentsSigRes = new Response(entrySig as any);
		const contentsSigStr = await contentsSigRes.text();
		const contentsSig = JSON.parse(contentsSigStr);

		const { digest, signature } = contentsSig;

		expect(digest).to.equal(
			'699ae1dd211d69539636f02b651ba88c5eac79b32b193579824928758036f684',
		);
		expect(signer.isValid(publicKey, signature, contentsStr)).to.equal(true);
	});
});
