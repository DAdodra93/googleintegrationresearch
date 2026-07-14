import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Refresh tokens at rest: AES-256-GCM, format "v1.<iv>.<ciphertext>.<tag>" (base64url).
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.');
}

export function decryptSecret(encoded: string, key: Buffer): string {
  const [v, ivB64, ctB64, tagB64] = encoded.split('.');
  if (v !== 'v1' || !ivB64 || !ctB64 || !tagB64) throw new Error('bad ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

/** HMAC-signed opaque payloads (OAuth `state`): "<body>.<sig>" (base64url). */
export function signPayload(payload: object, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyPayload<T>(token: string, key: Buffer): T {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Error('bad state token');
  const expected = createHmac('sha256', key).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('state signature mismatch');
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
}
