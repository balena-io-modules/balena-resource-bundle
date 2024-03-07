import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import * as stream from 'node:stream';
import * as tar from 'tar-stream';

import * as bundle from '../lib';
import { sha256sum } from '../lib/hasher';

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

function stringStream(str: string): stream.Readable {
	// TODO: Check objectMode
	return stream.Readable.from([str], { objectMode: false });
}

class ErroringStream extends stream.Readable {
	shouldError: boolean = false;

	constructor(private content: string) {
		// TODO: Check objectMode
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

function createTarBundle(contents) {
	const pack = tar.pack();

	const contentsJson = JSON.stringify(contents);

	pack.entry({ name: 'contents.json' }, contentsJson);

	const signature = {
		digest: sha256sum(contentsJson),
	};

	pack.entry({ name: 'contents.sig' }, JSON.stringify(signature));

	return pack;
}

function createEmptyTestBundle(contents) {
	const pack = createTarBundle(contents);

	pack.finalize();

	const readable = bundle.open(pack, 'foo@1');

	return readable;
}

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

		const hello = stringStream('hello');
		await myBundle.addResource('hello', hello);

		const world = stringStream('world');
		await myBundle.addResource('world', world);

		await myBundle.finalize();

		const readableBundle = bundle.open(myBundle.pack, 'foo@1');

		const manifest = await readableBundle.manifest();

		for await (const { resource } of readableBundle.resources()) {
			// TODO: Pipe the stream into a string a compare result
			resource.resume();
			// TODO: Compare descriptors
		}

		expect(manifest).to.eql(['hello.txt', 'world.txt']);
	});

	it('add resource with stream throwing an error', async () => {
		const myBundle = bundle.create({
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

		const hello = new ErroringStream('hello');

		try {
			await myBundle.addResource('hello', hello);
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('ErroringStream is throwing an error');
		}
	});

	it('add resource with wrong size', async () => {
		const myBundle = bundle.create({
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 100,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		});

		try {
			const hello = stringStream('hello');
			await myBundle.addResource('hello', hello);
			expect.fail('Unreachable');
		} catch (error) {
			// TODO: Can we add the resource ID in the error message?
			expect(error.message).to.equal('Size mismatch');
		}

		try {
			await myBundle.finalize();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Size mismatch');
		}
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

		const hello = stringStream('hello');

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

		const hello = stringStream('hello');
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

		const hello = stringStream('hello');
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

	it('read contents.json with missing version', async () => {
		const contents = {
			// version: '1',
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					path: 'hello.txt',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Missing "version" in contents.json');
		}
	});

	it('read contents.json with missing type', async () => {
		const contents = {
			version: '1',
			// type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					path: 'hello.txt',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Missing "type" in contents.json');
		}
	});

	it('read contents.json with missing manifest', async () => {
		const contents = {
			version: '1',
			type: 'foo@1',
			// manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					path: 'hello.txt',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Missing "manifest" in contents.json');
		}
	});

	it('read contents.json with missing resources', async () => {
		const contents = {
			version: '1',
			type: 'foo@1',
			manifest: ['hello.txt'],
			// resources: [...]
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal('Missing "resources" in contents.json');
		}
	});

	it('read contents.json with missing resource id', async () => {
		const contents = {
			version: '1',
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					// id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Missing "id" in "resources" of contents.json',
			);
		}
	});

	it('read contents.json with missing resource size', async () => {
		const contents = {
			version: '1',
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					// size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Missing "size" in "resources" of contents.json',
			);
		}
	});

	it('read contents.json with missing resource digest', async () => {
		const contents = {
			version: '1',
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					size: 5,
					// digest: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Missing "digest" in "resources" of contents.json',
			);
		}
	});
});
