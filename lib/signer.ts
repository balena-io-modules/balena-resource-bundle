import { createSign, createVerify } from 'node:crypto';

export function sign(privateKey: string, contents: string): string {
	const signed = createSign('SHA256');
	signed.write(contents);
	signed.end();
	return signed.sign(privateKey, 'hex');
}

export function isValid(
	publicKey: string,
	signature: string,
	contents: string,
): boolean {
	const verify = createVerify('SHA256');
	verify.write(contents);
	verify.end();
	return verify.verify(publicKey, signature, 'hex');
}
