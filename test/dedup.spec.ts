import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';

import { stringToStream, streamToString } from './utils';
import * as bundle from '../src';
import type { Resource } from '../src/types';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('deduplication tests', () => {
	it('create a bundle with duplicates and iterate over it', async () => {
		const myBundle = bundle.create({
			type: 'foo@1',
			manifest: ['hello 1', 'world 1'],
			resources: [
				{
					id: 'hello 1',
					aliases: ['hello 2'],
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
				{
					id: 'world 1',
					aliases: ['world 2'],
					size: 5,
					digest:
						'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
				},
			],
		});

		const hello1 = stringToStream('hello');
		myBundle.addResource('hello 1', hello1);

		const world1 = stringToStream('world');
		myBundle.addResource('world 1', world1);

		myBundle.finalize();

		const readableBundle = bundle.open(myBundle.stream, 'foo@1');
		const manifest = await readableBundle.manifest();

		const resources = new Array<string>();
		const allDescriptors = new Array<Resource>();
		for await (const { resource, descriptor } of readableBundle.resources()) {
			const contents = await streamToString(resource);
			resources.push(contents);
			allDescriptors.push(descriptor);
		}

		expect(manifest).to.eql(['hello 1', 'world 1']);
		expect(resources).to.eql(['hello', 'world']);
		expect(allDescriptors).to.eql([
			{
				id: 'hello 1',
				aliases: ['hello 2'],
				size: 5,
				digest:
					'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
			},
			{
				id: 'world 1',
				aliases: ['world 2'],
				size: 5,
				digest:
					'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
			},
		]);
	});
});
