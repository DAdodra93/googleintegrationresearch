import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, signPayload, verifyPayload } from '../src/core/crypto.js';

describe('secret encryption', () => {
  const key = randomBytes(32);

  it('round-trips', () => {
    const enc = encryptSecret('1//refresh-token-secret', key);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(decryptSecret(enc, key)).toBe('1//refresh-token-secret');
  });

  it('unique ciphertexts per call (random IV)', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key));
  });

  it('rejects wrong key and tampering', () => {
    const enc = encryptSecret('secret', key);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
    const parts = enc.split('.');
    parts[2] = Buffer.from('tampered!').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });
});

describe('signed state payloads', () => {
  const key = randomBytes(32);

  it('round-trips and verifies', () => {
    const token = signPayload({ merchantId: 'm1', module: 'gbp' }, key);
    expect(verifyPayload<{ merchantId: string }>(token, key).merchantId).toBe('m1');
  });

  it('rejects forged signature', () => {
    const token = signPayload({ a: 1 }, key);
    const [body] = token.split('.');
    expect(() => verifyPayload(`${body}.${'A'.repeat(43)}`, key)).toThrow();
    expect(() => verifyPayload(token, randomBytes(32))).toThrow();
  });
});
