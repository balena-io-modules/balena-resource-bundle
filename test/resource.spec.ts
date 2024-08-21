import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../src';

import { ErroringStream } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('lazy resource data', () => {
	it('awaits lazy resource data promise', async () => {
		const myBundleStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt', 'world.txt'],
			resources: [
				{
					id: 'hello.txt',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: bundle.stringToStream('hello'),
				},
				{
					id: 'world.txt',
					size: 5,
					digest:
						'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
					data: async function lazydata() {
						return new Promise((resolve) => {
							setImmediate(() => resolve(bundle.stringToStream('world')));
						});
					},
				},
			],
		});

		const readableBundle = await bundle.open(myBundleStream, 'foo@1');
		const manifest = readableBundle.manifest;

		const resources = new Array<string>();
		const allDescriptors = new Array<bundle.ResourceDescriptor>();
		for (const resource of readableBundle.resources) {
			const contents = await bundle.streamToString(resource.data);
			resources.push(contents);
			allDescriptors.push(bundle.describeResource(resource));
		}

		expect(manifest).to.eql(['hello.txt', 'world.txt']);
		expect(resources).to.eql(['hello', 'world']);
		expect(allDescriptors).to.eql([
			{
				id: 'hello.txt',
				size: 5,
				digest:
					'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
			},
			{
				id: 'world.txt',
				size: 5,
				digest:
					'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
			},
		]);
	});

	it('catches thrown errors', async () => {
		const myBundleStream = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt', 'world.txt'],
			resources: [
				{
					id: 'hello.txt',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: bundle.stringToStream('hello'),
				},
				{
					id: 'world.txt',
					size: 5,
					digest:
						'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
					data: async function lazydata() {
						return new Promise((_resolve, reject) => {
							setImmediate(() =>
								reject(new Error('Failed to fetch world.txt')),
							);
						});
					},
				},
			],
		});

		try {
			await stream.promises.finished(myBundleStream);
			expect.fail('Unreachable');
		} catch (err) {
			expect(err.message).to.equal('Failed to fetch world.txt');
		}
	});
});

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
