import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../src';

import { ErroringStream } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('read/write resources failures', () => {
	it('add resource with stream throwing an error', async () => {
		const myBundleStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: new ErroringStream('hello'),
				},
			],
		});

		try {
			await stream.promises.finished(myBundleStream);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('ErroringStream is throwing an error');
		}
	});

	it('add resource with wrong size', async () => {
		const myBundleStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 100,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: bundle.stringToStream('hello'),
				},
			],
		});

		try {
			await stream.promises.finished(myBundleStream);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Size mismatch');
		}
	});

	it('add resource which was already added', async () => {
		const descriptor = {
			id: 'hello',
			size: 5,
			digest:
				'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
		};

		try {
			bundle.create({
				type: 'foo@1',
				manifest: ['hello.txt'],
				resources: [
					{
						...descriptor,
						data: bundle.stringToStream('hello'),
					},
					{
						...descriptor,
						data: bundle.stringToStream('hello'),
					},
				],
			});
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Found duplicate resource IDs: hello');
		}
	});
});
