import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../src';

import { ErroringStream, gather } from './utils';

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

		const { data, resources } = await gather(readableBundle);

		expect(manifest).to.eql(['hello.txt', 'world.txt']);
		expect(data).to.eql(['hello', 'world']);
		expect(resources).to.eql([
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

describe('multipart resources', () => {
	it('can embed a multipart resource', async () => {
		const myBundleStream = bundle.create({
			type: 'nested-concat@1',
			manifest: { separator: ' ' },
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
					data: bundle.stringToStream('world'),
				},
				{
					id: 'test-multipart-resource',
					contents: {
						type: 'concat@1',
						manifest: { separator: ', ' },
						resources: [
							{
								id: 'foo.txt',
								size: 3,
								digest:
									'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
								data: bundle.stringToStream('foo'),
							},
							{
								id: 'bar.txt',
								size: 3,
								digest:
									'sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
								data: async function lazydata() {
									return new Promise((resolve) => {
										setImmediate(() => resolve(bundle.stringToStream('bar')));
									});
								},
							},
						],
					},
				},
			],
		});

		const readableBundle = await bundle.open(myBundleStream, 'nested-concat@1');
		const manifest = readableBundle.manifest;

		const { data, resources } = await gather(readableBundle);

		expect(manifest).to.eql({ separator: ' ' });
		expect(data).to.eql(['hello', 'world', 'foo', 'bar']);
		expect(resources).to.eql([
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
			{
				id: 'foo.txt',
				size: 3,
				digest:
					'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
			},
			{
				id: 'bar.txt',
				size: 3,
				digest:
					'sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
			},
		]);
	});

	it('can embed multipart resources recursively', async () => {
		const myBundleStream = bundle.create({
			type: 'nested-concat@1',
			manifest: { separator: ' ' },
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
					data: bundle.stringToStream('world'),
				},
				{
					id: 'test-multipart-resource',
					contents: {
						type: 'concat@1',
						manifest: { separator: ', ' },
						resources: [
							{
								id: 'foo.txt',
								size: 3,
								digest:
									'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
								data: bundle.stringToStream('foo'),
							},
							{
								id: 'test-nested-multipart-resource',
								contents: {
									type: 'nested-concat@1',
									manifest: { separator: ' ' },
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
											data: bundle.stringToStream('world'),
										},
									],
								},
							},
							{
								id: 'bar.txt',
								size: 3,
								digest:
									'sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
								data: async function lazydata() {
									return new Promise((resolve) => {
										setImmediate(() => resolve(bundle.stringToStream('bar')));
									});
								},
							},
						],
					},
				},
			],
		});

		const readableBundle = await bundle.open(myBundleStream, 'nested-concat@1');
		const manifest = readableBundle.manifest;

		const { data, resources } = await gather(readableBundle);

		expect(manifest).to.eql({ separator: ' ' });
		expect(data).to.eql(['hello', 'world', 'foo', 'hello', 'world', 'bar']);
		expect(resources).to.eql([
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
			{
				id: 'foo.txt',
				size: 3,
				digest:
					'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
			},
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
			{
				id: 'bar.txt',
				size: 3,
				digest:
					'sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
			},
		]);
	});

	it('can embed a readable bundle', async () => {
		const myOtherBundleStream = bundle.create({
			type: 'nested-concat@1',
			manifest: { separator: ' ' },
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
					data: bundle.stringToStream('world'),
				},
			],
		});

		const myOtherBundle = await bundle.open(
			myOtherBundleStream,
			'nested-concat@1',
		);

		const myBundleStream = bundle.create({
			type: 'nested-concat@1',
			manifest: { separator: ' ' },
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
					data: bundle.stringToStream('world'),
				},
				{
					id: 'test-multipart-resource',
					contents: {
						type: 'concat@1',
						manifest: { separator: ', ' },
						resources: [
							{
								id: 'foo.txt',
								size: 3,
								digest:
									'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
								data: bundle.stringToStream('foo'),
							},
							{
								id: 'test-nested-multipart-resource',
								contents: myOtherBundle.contents,
							},
							{
								id: 'bar.txt',
								size: 3,
								digest:
									'sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
								data: async function lazydata() {
									return new Promise((resolve) => {
										setImmediate(() => resolve(bundle.stringToStream('bar')));
									});
								},
							},
						],
					},
				},
			],
		});

		const readableBundle = await bundle.open(myBundleStream, 'nested-concat@1');
		const manifest = readableBundle.manifest;

		const { data, resources } = await gather(readableBundle);

		expect(manifest).to.eql({ separator: ' ' });
		expect(data).to.eql(['hello', 'world', 'foo', 'hello', 'world', 'bar']);
		expect(resources).to.eql([
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
			{
				id: 'foo.txt',
				size: 3,
				digest:
					'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
			},
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
			{
				id: 'bar.txt',
				size: 3,
				digest:
					'sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
			},
		]);
	});
});
