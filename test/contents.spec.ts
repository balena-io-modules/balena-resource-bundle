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
