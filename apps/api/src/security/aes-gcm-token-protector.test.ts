import { describe, expect, it } from 'vitest';

import { AesGcmTokenProtector } from './aes-gcm-token-protector.js';

const encryptionKey = Buffer.alloc(32, 1).toString('base64');

describe('AesGcmTokenProtector', () => {
  it('round-trips a plaintext token through a versioned envelope', () => {
    const protector = new AesGcmTokenProtector(encryptionKey);
    const protectedToken = protector.encrypt('instagram-access-token');

    expect(protectedToken).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(protectedToken).not.toContain('instagram-access-token');
    expect(protector.decrypt(protectedToken)).toBe('instagram-access-token');
  });

  it('uses a unique nonce for every encryption', () => {
    const protector = new AesGcmTokenProtector(encryptionKey);

    expect(protector.encrypt('same-token')).not.toBe(protector.encrypt('same-token'));
  });

  it('rejects a modified ciphertext', () => {
    const protector = new AesGcmTokenProtector(encryptionKey);
    const parts = protector.encrypt('instagram-access-token').split('.');
    const ciphertext = parts[3] ?? '';
    const replacement = ciphertext.endsWith('A') ? 'B' : 'A';
    parts[3] = `${ciphertext.slice(0, -1)}${replacement}`;

    expect(() => protector.decrypt(parts.join('.'))).toThrowError(
      'Protected token authentication failed',
    );
  });

  it('rejects decryption with a different key', () => {
    const protector = new AesGcmTokenProtector(encryptionKey);
    const otherProtector = new AesGcmTokenProtector(Buffer.alloc(32, 2).toString('base64'));

    expect(() => otherProtector.decrypt(protector.encrypt('instagram-access-token'))).toThrowError(
      'Protected token authentication failed',
    );
  });

  it.each(['', 'v2.invalid.envelope.value', 'v1.invalid'])(
    'rejects the malformed or unsupported envelope %j',
    (protectedToken) => {
      const protector = new AesGcmTokenProtector(encryptionKey);

      expect(() => protector.decrypt(protectedToken)).toThrowError('Invalid protected token');
    },
  );

  it.each(['not-base64', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64')])(
    'rejects the invalid encryption key %j',
    (invalidKey) => {
      expect(() => new AesGcmTokenProtector(invalidKey)).toThrowError(/32-byte key/);
    },
  );

  it('rejects an empty plaintext token', () => {
    const protector = new AesGcmTokenProtector(encryptionKey);

    expect(() => protector.encrypt('')).toThrowError('Plaintext token must not be empty');
  });
});
