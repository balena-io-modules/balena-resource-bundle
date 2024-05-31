import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../src';

import { createTarBundle } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('hash failures', () => {
	it('add resource with bad hash', async () => {
		const writableStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest: 'sha256:deadbeef',
					data: bundle.stringToStream('hello'),
				},
			],
		});

		try {
			await stream.promises.finished(writableStream);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Expected digest sha256:deadbeef does not match calculated digest sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
			);
		}
	});

	it('read resource with bad hash', async () => {
		const pack = createTarBundle({
			version: '1',
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest: 'sha256:deadbeef',
				},
			],
		});

		pack.entry(
			{
				name: 'resources/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
			},
			'hello',
		);

		pack.finalize();

		const readable = await bundle.read(pack, 'foo@1');

		try {
			for (const resource of readable.resources) {
				await stream.promises.finished(resource.data);
			}
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Expected digest sha256:deadbeef does not match calculated digest sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
			);
		}
	});

	it('add resource with unknown digest algorithm', async () => {
		const writable = new bundle.WritableBundle({
			type: 'foo@1',
			manifest: ['hello.txt'],
		});

		writable.addResource({
			id: 'hello.txt',
			size: 5,
			digest: 'unk256:aaaaaaaa',
			data: bundle.stringToStream('hello'),
		});

		try {
			// TODO: this should throw on addResource instead
			writable.finalize();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Digest method not supported');
		}
	});

	it('add resource with malformed digest', async () => {
		const writable = new bundle.WritableBundle({
			type: 'foo@1',
			manifest: ['hello.txt'],
		});

		writable.addResource({
			id: 'hello.txt',
			size: 5,
			digest: 'sha256_aaaaaaaaaaaaaaaa',
			data: bundle.stringToStream('hello'),
		});

		try {
			// TODO: this should throw on addResource instead
			writable.finalize();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Malformed digest sha256_aaaaaaaaaaaaaaaa',
			);
		}
	});
});
