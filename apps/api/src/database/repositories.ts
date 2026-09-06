import type { SessionTokenHash } from '../security/session-token.js';
import type { ProtectedToken } from '../security/token-protector.js';

/** Persisted Instagram Professional account owned by an application user. */
export interface InstagramAccount {
  /** Encrypted Instagram access token available only to backend code. */
  accessTokenCiphertext: ProtectedToken;

  /** Time at which the account row was created. */
  createdAt: Date;

  /** Internal immutable account identifier. */
  id: string;

  /** Opaque Instagram account identifier supplied by Meta. */
  instagramUserId: string;

  /** Instant after which the Instagram access token must not be used. */
  tokenExpiresAt: Date;

  /** Time at which the account row was last changed. */
  updatedAt: Date;

  /** Current Instagram username shown to the owner. */
  username: string;
}

/** Input used to create or refresh a connected Instagram account. */
export interface UpsertConnectedAccountInput {
  /** AES-GCM-protected Instagram access token. */
  accessTokenCiphertext: ProtectedToken;

  /** Opaque Instagram account identifier supplied by Meta. */
  instagramUserId: string;

  /** Instant after which the supplied Instagram token must not be used. */
  tokenExpiresAt: Date;

  /** Current Instagram username returned by Meta. */
  username: string;
}

/** Persistence operations required by Instagram account connection and webhook processing. */
export interface AccountRepository {
  /**
   * Finds an account by its external Instagram identifier.
   *
   * @param instagramUserId - Opaque Instagram account identifier.
   * @returns The matching account, or `null` when it has not been connected.
   */
  findByInstagramUserId(instagramUserId: string): Promise<InstagramAccount | null>;

  /**
   * Creates a connected account or refreshes its mutable connection details.
   *
   * @param input - External identity, username, protected token, and token expiry.
   * @returns The inserted or updated account while preserving its internal identifier.
   */
  upsertConnectedAccount(input: UpsertConnectedAccountInput): Promise<InstagramAccount>;
}

/** Persisted application login session without its credential hash. */
export interface Session {
  /** Internal account identifier that owns the session. */
  accountId: string;

  /** Time at which the session row was created. */
  createdAt: Date;

  /** Instant after which the session must not authenticate requests. */
  expiresAt: Date;

  /** Internal immutable session identifier. */
  id: string;
}

/** Active session and its connected Instagram account. */
export interface AuthenticatedSession {
  /** Connected account authenticated by the session credential. */
  account: InstagramAccount;

  /** Active, unexpired application session. */
  session: Session;
}

/** Input used to persist a newly generated application session. */
export interface CreateSessionInput {
  /** Internal account identifier that owns the session. */
  accountId: string;

  /** Instant after which the session must not authenticate requests. */
  expiresAt: Date;

  /** SHA-256 digest of the credential given to the browser. */
  tokenHash: SessionTokenHash;
}

/** Persistence operations required by authentication and logout. */
export interface SessionRepository {
  /**
   * Creates a session containing only a hash of its browser credential.
   *
   * @param input - Owning account, expiration instant, and credential hash.
   * @returns The persisted session without its hash.
   */
  createSession(input: CreateSessionInput): Promise<Session>;

  /**
   * Deletes a session for logout without accepting the raw browser credential.
   *
   * @param tokenHash - SHA-256 digest of the presented session credential.
   * @returns `true` when a session was deleted; otherwise `false`.
   */
  deleteByTokenHash(tokenHash: SessionTokenHash): Promise<boolean>;

  /**
   * Resolves an unexpired session and its connected account.
   *
   * @param tokenHash - SHA-256 digest of the presented session credential.
   * @returns Authenticated session data, or `null` for an unknown or expired credential.
   */
  findActiveByTokenHash(tokenHash: SessionTokenHash): Promise<AuthenticatedSession | null>;
}
