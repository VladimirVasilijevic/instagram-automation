import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { TokenProtector } from './token-protector.js';

const algorithm = 'aes-256-gcm';
const envelopeVersion = 'v1';
const nonceLengthBytes = 12;
const authenticationTagLengthBytes = 16;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

const invalidEnvelope = (): Error => new Error('Invalid protected token');

const decodeEnvelopePart = (encodedValue: string): Buffer => {
  if (!base64UrlPattern.test(encodedValue)) {
    throw invalidEnvelope();
  }

  const decodedValue = Buffer.from(encodedValue, 'base64url');

  if (decodedValue.toString('base64url') !== encodedValue) {
    throw invalidEnvelope();
  }

  return decodedValue;
};

const decodeEncryptionKey = (encodedKey: string): Buffer => {
  const key = Buffer.from(encodedKey, 'base64');

  if (key.byteLength !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('Token encryption key must be a Base64-encoded 32-byte key');
  }

  return key;
};

/** AES-256-GCM implementation of token encryption and authenticated decryption. */
export class AesGcmTokenProtector implements TokenProtector {
  readonly #key: Buffer;

  /**
   * Creates a token protector from a Base64-encoded 256-bit key.
   *
   * @param encodedKey - Base64-encoded key containing exactly 32 bytes.
   * @throws When the supplied key is not canonical Base64 or is not exactly 32 bytes.
   */
  constructor(encodedKey: string) {
    this.#key = decodeEncryptionKey(encodedKey);
  }

  /** Encrypts a non-empty token with a newly generated 96-bit nonce. */
  encrypt(plaintextToken: string): string {
    if (plaintextToken.length === 0) {
      throw new Error('Plaintext token must not be empty');
    }

    const nonce = randomBytes(nonceLengthBytes);
    const cipher = createCipheriv(algorithm, this.#key, nonce, {
      authTagLength: authenticationTagLengthBytes,
    });
    const ciphertext = Buffer.concat([cipher.update(plaintextToken, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return [
      envelopeVersion,
      nonce.toString('base64url'),
      authenticationTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /** Authenticates and decrypts a supported token envelope. */
  decrypt(protectedToken: string): string {
    const parts = protectedToken.split('.');

    if (parts.length !== 4 || parts[0] !== envelopeVersion) {
      throw invalidEnvelope();
    }

    const nonce = decodeEnvelopePart(parts[1] ?? '');
    const authenticationTag = decodeEnvelopePart(parts[2] ?? '');
    const ciphertext = decodeEnvelopePart(parts[3] ?? '');

    if (
      nonce.byteLength !== nonceLengthBytes ||
      authenticationTag.byteLength !== authenticationTagLengthBytes
    ) {
      throw invalidEnvelope();
    }

    try {
      const decipher = createDecipheriv(algorithm, this.#key, nonce, {
        authTagLength: authenticationTagLengthBytes,
      });
      decipher.setAuthTag(authenticationTag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Protected token authentication failed');
    }
  }
}
