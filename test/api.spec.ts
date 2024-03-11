import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';

import { stringToStream } from './utils';
import * as bundle from '../lib';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('api mishandling', () => {
	it('read resources without accessing manifest', async () => {
		const writable = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		});

		const hello = stringToStream('hello');
		await writable.addResource('hello', hello);

		await writable.finalize();

		const readable = bundle.open(writable.pack, 'foo@1');

		try {
			await readable.resources().next();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Must call `manifest()` before `resources()`',
			);
		}
	});

	it('read manifest with mismatching bundle type', async () => {
		const writable = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		});

		const hello = stringToStream('hello');
		await writable.addResource('hello', hello);

		await writable.finalize();

		const readable = bundle.open(writable.pack, 'bar@1');

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Expected type (bar@1) does not match received type (foo@1)',
			);
		}
	});
});
