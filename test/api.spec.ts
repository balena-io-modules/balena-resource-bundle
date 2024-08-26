import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';

import * as bundle from '../src';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('api misuse', () => {
	it('read manifest with incorrect bundle type', async () => {
		const writableStream = bundle.create({
			type: 'foo@1',
			manifest: null,
			resources: [
				{
					id: 'hello',
					size: 5,
					digest:
						'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					data: bundle.stringToStream('hello'),
				},
			],
		});

		try {
			await bundle.open(writableStream, 'bar@1');
			expect.fail('Unreachable');
		} catch (error) {
			expect(error.message).to.equal(
				'Expected type (bar@1) does not match received type (foo@1)',
			);
		}
	});
});
