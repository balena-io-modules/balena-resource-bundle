import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../src';

import { ErroringStream, stringToStream } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('read/write resources failures', () => {
	it('add resource with stream throwing an error', async () => {
		const myBundle = bundle.create({
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

		const hello = new ErroringStream('hello');
		myBundle.addResource('hello', hello);

		try {
			await stream.promises.finished(myBundle.stream);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('ErroringStream is throwing an error');
		}
	});

	it('add resource with wrong size', async () => {
		const myBundle = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 100,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		});

		const hello = stringToStream('hello');
		myBundle.addResource('hello', hello);
		myBundle.finalize();

		try {
			await stream.promises.finished(myBundle.stream);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Size mismatch');
		}
	});

	it('add resource with wrong ID', async () => {
		const myBundle = bundle.create({
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

		try {
			myBundle.addResource('world', hello);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Adding unknown resource "world"');
		}
	});

	it('add resource which was already added', async () => {
		const myBundle = bundle.create({
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
		myBundle.addResource('hello', hello);

		const hello2 = stringToStream('hello');

		try {
			myBundle.addResource('hello', hello2);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Resource "hello" is already added');
		}
	});

	it('finalize without all resources added', async () => {
		const myBundle = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt', 'world.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
				{
					id: 'world',
					size: 5,
					digest:
						'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
				},
			],
		});

		const hello = stringToStream('hello');
		myBundle.addResource('hello', hello);

		try {
			myBundle.finalize();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Missing resources: world');
		}
	});

	it('create bundle with duplicated resource IDs', async () => {
		try {
			bundle.create({
				type: 'foo@1',
				manifest: ['hello.txt', 'world.txt'],
				resources: [
					{
						id: 'hello',
						size: 5,
						digest:
							'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					},
					{
						id: 'hello',
						size: 5,
						digest:
							'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
					},
				],
			});

			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Duplicate resource IDs are not allowed: hello',
			);
		}
	});
});
