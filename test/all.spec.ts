import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../lib';

import type { Resource } from '../lib/types';

import { stringToStream, createTarBundle, streamToString } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

// TODO: Split all tests in separate modules

/*
{
  "version": "1",
  "type": "release@4",
  "manifest": {
    // the portion of the API state endpoint that
    // describes a single app.
  },
  "resources": [
    {
	  "id": "registry2.balena-cloud.com/v2/cafebabe",
      "type": "tar.gz",
	  "size": 100,
      "digest": "sha256:deadbeef"
    },
    {
	  "id": "registry2.balena-cloud.com/v2/caf3babe",
      "type": "tar.gz",
      "size": 200,
      "digest": "sha256:deadbeef"
    }
  ]
}
*/

describe('basic usage', () => {
	it('create bundle and then open it and read it', async () => {
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
		await myBundle.addResource('hello', hello);

		const world = stringToStream('world');
		await myBundle.addResource('world', world);

		await myBundle.finalize();

		const readableBundle = bundle.open(myBundle.pack, 'foo@1');

		const manifest = await readableBundle.manifest();

		const resources = new Array<string>();
		const allDescriptors = new Array<Resource[]>();
		for await (const { resource, descriptors } of readableBundle.resources()) {
			const contents = await streamToString(resource);
			resources.push(contents);
			allDescriptors.push(descriptors);
		}

		expect(manifest).to.eql(['hello.txt', 'world.txt']);
		expect(resources).to.eql(['hello', 'world']);
		expect(allDescriptors).to.eql([
			[
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
			[
				{
					id: 'world',
					size: 5,
					digest:
						'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
				},
			],
		]);
	});

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
