import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';

import * as bundle from '../lib';

chai.use(chaiAsPromised);
const expect = chai.expect;

function stringStream(str: string): stream.Readable {
	// TODO: check objectMode
	return stream.Readable.from([str], { objectMode: false });
}

class ErroringStream extends stream.Readable {
	shouldError: boolean = false;

	constructor(private content: string) {
		// TODO: check objectMode
		super({ objectMode: false });
	}

	_read() {
		if (this.shouldError) {
			this.emit('error', new Error('ErroringStream is throwing an error'));
		} else {
			this.push(this.content);

			this.shouldError = true;
		}
	}
}

describe('basic usage', () => {
	it('create bundle', async () => {
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

		for await (const entry of readableBundle.resources()) {
			entry.resume();
		}

		expect(manifest).to.eql(['hello.txt', 'world.txt']);
	});

	it('addResource with erroring stream', async () => {
		const myBundle = bundle.create({
			type: 'io.balena.foo@1',
			manifest: ['hello.txt', 'world.txt'],
		});

		const hello = new ErroringStream('hello');

		try {
			await myBundle.addResource('hello.txt', 5, hello);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('ErroringStream is throwing an error');
		}
	});

	it('add resource with wrong size', async () => {
		const myBundle = bundle.create({
			type: 'io.balena.foo@1',
			manifest: ['hello.txt'],
		});

		try {
			const hello = stringStream('hello');
			await myBundle.addResource('hello.txt', 100, hello);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Size mismatch');
		}

		try {
			await myBundle.finalize();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Size mismatch');
		}
	});
});
