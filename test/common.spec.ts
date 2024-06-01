import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';

import * as bundle from '../src';

import { sha256sum } from '../src/hasher';

import { repeatedStringToStream } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

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

describe('common usage', () => {
	it('create bundle and then read it', async () => {
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
					data: bundle.stringToStream('world'),
				},
			],
		});

		const readableBundle = await bundle.read(myBundleStream, 'foo@1');
		const manifest = readableBundle.manifest;

		const resources = new Array<string>();
		const allDescriptors = new Array<bundle.ResourceDescriptor>();
		for (const resource of readableBundle.resources) {
			const contents = await bundle.streamToString(resource.data);
			resources.push(contents);
			allDescriptors.push(bundle.getResourceDescriptor(resource));
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

	it('create bundle and concurently add resources', async () => {
		const count = 50000;
		const strings = ['hello'.repeat(count), 'world'.repeat(count)];

		const myBundle = new bundle.WritableBundle({
			type: 'foo@1',
			manifest: ['hello.txt', 'world.txt'],
		});

		[
			{
				id: 'hello.txt',
				size: strings[0].length,
				digest: 'sha256:' + sha256sum(strings[0]),
				data: repeatedStringToStream('hello', count),
			},
			{
				id: 'world.txt',
				size: strings[1].length,
				digest: 'sha256:' + sha256sum(strings[1]),
				data: repeatedStringToStream('world', count),
			},
		].forEach((resource) => {
			myBundle.addResource(resource);
		});

		const myBundleStream = myBundle.finalize();

		const readableBundle = await bundle.read(myBundleStream, 'foo@1');
		const manifest = readableBundle.manifest;

		const resources = new Array<string>();
		const allDescriptors = new Array<bundle.ResourceDescriptor>();
		for (const resource of readableBundle.resources) {
			const contents = await bundle.streamToString(resource.data);
			resources.push(contents);
			allDescriptors.push(bundle.getResourceDescriptor(resource));
		}

		expect(manifest).to.eql(['hello.txt', 'world.txt']);
		expect(resources).to.eql(strings);
		expect(allDescriptors).to.eql([
			{
				id: 'hello.txt',
				size: 250000,
				digest:
					'sha256:3c0c935cd2e22bf98bfa3e53d5854c607b5e603528f9e107d231f3b00e6a792d',
			},
			{
				id: 'world.txt',
				size: 250000,
				digest:
					'sha256:98d4b55cb3f642fc5867b797e51d88e53b0526e75ee7006ed4bfe0397e4636bf',
			},
		]);
	});
});
