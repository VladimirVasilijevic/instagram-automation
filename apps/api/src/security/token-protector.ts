declare const protectedTokenBrand: unique symbol;

/** Opaque encrypted-token value accepted by persistence boundaries. */
export type ProtectedToken = string & {
  /** Compile-time marker preventing plaintext strings from crossing persistence boundaries. */
  readonly [protectedTokenBrand]: true;
};

/** Encrypts and authenticates sensitive tokens stored by the application. */
export interface TokenProtector {
  /**
   * Encrypts a plaintext token into a versioned, authenticated value suitable for persistence.
   *
   * @param plaintextToken - Non-empty sensitive token to protect.
   * @returns An encoded value containing everything except the encryption key needed for decryption.
   * @throws When the plaintext token is empty.
   */
  encrypt(plaintextToken: string): ProtectedToken;

  /**
   * Authenticates and decrypts a value previously returned by {@link encrypt}.
   *
   * @param protectedToken - Versioned encrypted token envelope.
   * @returns The original plaintext token.
   * @throws When the envelope is malformed, unsupported, or fails authentication.
   */
  decrypt(protectedToken: string): string;
}
