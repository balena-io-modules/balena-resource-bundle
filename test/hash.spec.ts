import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../lib';

import { stringToStream, createTarBundle } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('hash failures', () => {
	it('add resource with bad hash', async () => {
		const writable = bundle.create({
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

		const hello = stringToStream('hello');

		try {
			await writable.addResource('hello', hello);
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

		pack.entry({ name: 'resources/deadbeef' }, 'hello');

		pack.finalize();

		const readable = bundle.open(pack, 'foo@1');

		await readable.manifest();

		try {
			for await (const { resource } of readable.resources()) {
				await stream.promises.finished(resource);
			}
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Expected digest sha256:deadbeef does not match calculated digest sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
			);
		}
	});
});
