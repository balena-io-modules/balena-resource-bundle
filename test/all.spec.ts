import { expect } from 'chai';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../lib';

function stringStream(str: string): stream.Readable {
	// TODO: check objectMode
	return stream.Readable.from([str], { objectMode: false });
}

describe('basic usage', () => {
	it('create bundle', async (done) => {
		const myBundle = bundle.create({
			type: 'io.balena.foo@1',
			manifest: ['hello.txt', 'world.txt'],
		});

		const hello = stringStream('hello');
		await myBundle.addResource('hello.txt', 5, hello);

		const world = stringStream('world');
		await myBundle.addResource('world.txt', 5, world);

		await myBundle.finalize();

		const readableBundle = bundle.open(myBundle.pack, 'io.balena.foo@1');

		const manifest = await readableBundle.manifest();

		expect(manifest).to.equal(['hello.txt', 'world.txt']);

		for await (const entry of readableBundle.resources()) {
			entry.resume();
		}

		done();
	});
});
