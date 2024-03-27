import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';

import { createEmptyTestBundle } from './utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('contents.json validation', () => {
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

	it('read contents.json with wrong version', async () => {
		const contents = {
			version: '2',
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
			expect(error.message).to.equal(
				'Unsupported bundle version 2 (expected 1)',
			);
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

	it('read contents.json with malformed resource digest', async () => {
		const contents = {
			version: '1',
			type: 'foo@1',
			manifest: ['hello.txt'],
			resources: [
				{
					id: 'hello',
					path: 'hello.txt',
					size: 5,
					digest:
						'sha256_2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
				},
			],
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Resource with malformed digest sha256_2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
			);
		}
	});

	it('read contents.json with duplicated resource IDs', async () => {
		const contents = {
			version: '1',
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
					id: 'hello',
					size: 5,
					digest:
						'sha256:486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
				},
			],
		};

		const readable = createEmptyTestBundle(contents);

		try {
			await readable.manifest();
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Duplicate resource IDs found in contents.json: hello',
			);
		}
	});
});
