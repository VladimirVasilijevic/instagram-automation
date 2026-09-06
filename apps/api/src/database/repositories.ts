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

/** Persisted automation configuration for one connected Instagram account. */
export interface Automation {
  /** Internal account identifier that owns the automation. */
  accountId: string;

  /** Time at which the automation row was created. */
  createdAt: Date;

  /** Whether matching comments may currently trigger a reply. */
  enabled: boolean;

  /** Internal immutable automation identifier. */
  id: string;

  /** Opaque Instagram media identifier selected by the owner. */
  mediaId: string;

  /** Configured public reply sent for a matching comment. */
  replyText: string;

  /** Fixed trigger supported by the first vertical slice. */
  triggerText: '#Hello';

  /** Time at which the automation row was last changed. */
  updatedAt: Date;
}

/** Owner-controlled values used to create or replace an account's automation configuration. */
export interface SaveAutomationInput {
  /** Internal account identifier that owns the automation. */
  accountId: string;

  /** Whether matching comments may currently trigger a reply. */
  enabled: boolean;

  /** Opaque Instagram media identifier selected by the owner. */
  mediaId: string;

  /** Configured public reply sent for a matching comment. */
  replyText: string;
}

/** Persistence operations required by automation configuration and comment processing. */
export interface AutomationRepository {
  /**
   * Finds the single automation configured for an account.
   *
   * @param accountId - Internal owner account identifier.
   * @returns The account's automation, or `null` when none has been configured.
   */
  findByAccountId(accountId: string): Promise<Automation | null>;

  /**
   * Finds an enabled automation for an exact owner and media pair.
   *
   * @param accountId - Internal owner account identifier.
   * @param mediaId - Opaque Instagram media identifier from a normalized comment event.
   * @returns The enabled matching automation, or `null` when it must not run.
   */
  findEnabledByAccountAndMedia(accountId: string, mediaId: string): Promise<Automation | null>;

  /**
   * Creates or replaces the single automation configuration for an account.
   *
   * @param input - Owner, selected media, public reply, and enabled state.
   * @returns The inserted or updated automation while preserving its internal identifier.
   */
  saveAutomation(input: SaveAutomationInput): Promise<Automation>;
}

/** State of one claimed comment-processing attempt. */
export type ExecutionStatus = 'failed' | 'processing' | 'succeeded';

/** Persisted result of claiming and processing one Instagram comment. */
export interface Execution {
  /** Internal automation identifier that processed the comment. */
  automationId: string;

  /** Original comment text used for exact trigger matching. */
  commentText: string;

  /** Instagram username when supplied by the normalized webhook event. */
  commenterUsername: string | null;

  /** Time at which processing first claimed the comment. */
  createdAt: Date;

  /** Stable sanitized failure category safe for internal API responses. */
  errorCode: string | null;

  /** Sanitized failure description that contains no secrets or raw provider response. */
  errorMessage: string | null;

  /** Internal immutable execution identifier. */
  id: string;

  /** Opaque Instagram comment identifier used as the idempotency key. */
  instagramCommentId: string;

  /** Current processing state. */
  status: ExecutionStatus;

  /** Time at which the execution row was last changed. */
  updatedAt: Date;
}

/** Normalized comment values required to atomically claim an execution. */
export interface ClaimExecutionInput {
  /** Internal automation identifier selected for the comment. */
  automationId: string;

  /** Original comment text used for exact trigger matching. */
  commentText: string;

  /** Instagram username when supplied by the normalized webhook event. */
  commenterUsername: string | null;

  /** Opaque Instagram comment identifier used as the idempotency key. */
  instagramCommentId: string;
}

/** Sanitized failure values that are safe to persist and return through an internal API. */
export interface ExecutionFailure {
  /** Stable non-empty application-owned failure category. */
  errorCode: string;

  /** Non-empty description with secrets and raw provider details removed. */
  errorMessage: string;
}

/** Persistence operations required by idempotent comment processing and recent activity. */
export interface ExecutionRepository {
  /**
   * Atomically claims a comment for processing.
   *
   * @param input - Automation and normalized comment values.
   * @returns A new processing execution, or `null` when the comment was already claimed.
   */
  claimExecution(input: ClaimExecutionInput): Promise<Execution | null>;

  /**
   * Lists recent execution activity owned by one connected account.
   *
   * @param accountId - Internal owner account identifier.
   * @param limit - Integer result limit from 1 through 50.
   * @returns Account-owned executions ordered newest first.
   */
  listRecentByAccountId(accountId: string, limit: number): Promise<Execution[]>;

  /**
   * Completes a processing execution with sanitized failure information.
   *
   * @param executionId - Internal execution identifier.
   * @param failure - Non-empty application-owned and sanitized failure values.
   * @returns The failed execution, or `null` when it does not exist or is already terminal.
   */
  markFailed(executionId: string, failure: ExecutionFailure): Promise<Execution | null>;

  /**
   * Completes a processing execution successfully.
   *
   * @param executionId - Internal execution identifier.
   * @returns The succeeded execution, or `null` when it does not exist or is already terminal.
   */
  markSucceeded(executionId: string): Promise<Execution | null>;
}
