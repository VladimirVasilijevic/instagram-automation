import { createHash, randomBytes } from 'node:crypto';

const sessionTokenLengthBytes = 32;

declare const sessionTokenHashBrand: unique symbol;

/** Opaque SHA-256 session-token digest accepted by persistence boundaries. */
export type SessionTokenHash = string & {
  /** Compile-time marker preventing raw session credentials from being persisted. */
  readonly [sessionTokenHashBrand]: true;
};

/** Newly generated session credential and the non-reversible value suitable for persistence. */
export interface SessionToken {
  /** SHA-256 hash that may be stored in the database. */
  tokenHash: SessionTokenHash;

  /** High-entropy credential that must only be returned to the authenticated client. */
  token: string;
}

/**
 * Hashes a session token into the value used for server-side lookup.
 *
 * @param token - Non-empty, high-entropy session token.
 * @returns Lowercase hexadecimal SHA-256 digest.
 * @throws When the token is empty.
 */
export const hashSessionToken = (token: string): SessionTokenHash => {
  if (token.length === 0) {
    throw new Error('Session token must not be empty');
  }

  return createHash('sha256').update(token, 'utf8').digest('hex') as SessionTokenHash;
};

/**
 * Creates a 256-bit random session credential and its storage-safe SHA-256 hash.
 *
 * @returns The client credential and its corresponding database value.
 */
export const createSessionToken = (): SessionToken => {
  const token = randomBytes(sessionTokenLengthBytes).toString('base64url');

  return { token, tokenHash: hashSessionToken(token) };
};
