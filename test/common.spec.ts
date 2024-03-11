import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';

import * as bundle from '../lib';

import type { Resource } from '../lib/types';

import { stringToStream, streamToString } from './utils';

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
});
