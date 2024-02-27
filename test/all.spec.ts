import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';
import * as tar from 'tar-stream';

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

class TestableBundle {
	pack: tar.Pack;

	constructor() {
		const pack = tar.pack();
		this.pack = pack;
	}

	async addFile(name: string, contents: string) {
		this.pack.entry({ name: name }, contents);
	}

	async finalize() {
		this.pack.finalize();
	}
}

export function createTestable(): TestableBundle {
	return new TestableBundle();
}

/*

{
  "version": 1,
  "type": "io.balena.release@4",
  "manifest": {
    // the portion of the API state endpoint that
    // describes a single app.
  },
  "resources": {
    "registry2.balena-cloud.com/v2/cafebabe": {
      "type": "docker-image",
      "path": "image0.tar.gz",
      "digest": "sha256:deadbeef"
    },
    "registry2.balena-cloud.com/v2/caf3babe": {
      "type": "docker-image",
      "path": "image1.tar.gz",
      "digest": "sha256:deadbeef"
    }
  }
}

*/

describe('basic usage', () => {
	it('create bundle and then open it and read it', async () => {
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

	it('add resource with stream throwing an error', async () => {
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

	it('read resources without accessing manifest', async () => {
		const writable = bundle.create({
			type: 'io.balena.foo@1',
			manifest: ['hello.txt'],
		});

		const hello = stringStream('hello');
		await writable.addResource('hello.txt', 5, hello);

		await writable.finalize();

		const readable = bundle.open(writable.pack, 'io.balena.foo@1');

		try {
			await readable.resources().next();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Manifest is not yet accessed');
		}
	});

	it('read manifest with mismatching bundle type', async () => {
		const writable = bundle.create({
			type: 'io.balena.foo@1',
			manifest: ['hello.txt'],
		});

		const hello = stringStream('hello');
		await writable.addResource('hello.txt', 5, hello);

		await writable.finalize();

		const readable = bundle.open(writable.pack, 'io.balena.bar@1');

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Expected type (io.balena.bar@1) does not match received type (io.balena.foo@1)',
			);
		}
	});

	it('read contents.json with missing version', async () => {
		const pack = tar.pack();

		// No "version" specified
		const contents = {
			type: 'io.balena.foo@1',
			manifest: ['hello.txt'],
		};

		const json = JSON.stringify(contents);

		pack.entry({ name: 'contents.json' }, json);

		pack.finalize();

		const readable = bundle.open(pack, 'io.balena.foo@1');

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Missing "version" in contents.json');
		}
	});

	it('read contents.json with missing type', async () => {
		const pack = tar.pack();

		// No "contents.jsoncontents.json" specified
		const contents = {
			version: 1,
			manifest: ['hello.txt'],
		};

		const json = JSON.stringify(contents);

		pack.entry({ name: 'contents.json' }, json);

		pack.finalize();

		const readable = bundle.open(pack, 'io.balena.foo@1');

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Missing "type" in contents.json');
		}
	});

	it('read contents.json with missing manifest', async () => {
		const pack = tar.pack();

		// No "manifest" specified
		const contents = {
			version: 1,
			type: 'io.balena.foo@1',
		};

		const json = JSON.stringify(contents);

		pack.entry({ name: 'contents.json' }, json);

		pack.finalize();

		const readable = bundle.open(pack, 'io.balena.foo@1');

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Missing "manifest" in contents.json');
		}
	});
});
