import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';

import * as bundle from '../src';
import { gather } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('common usage', () => {
	it('create bundle and then read it', async () => {
		const myBundleStream = bundle.create({
			type: 'concat@1',
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

		const readableBundle = await bundle.open(myBundleStream, 'concat@1');
		const { manifest } = readableBundle;

		const { data, resources } = await gather(readableBundle);

		expect(manifest).to.eql({ separator: ' ' });
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
});
