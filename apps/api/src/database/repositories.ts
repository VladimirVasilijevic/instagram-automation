import type {
  DeliveryChannel,
  DeliveryMode,
  ExecutionStatus,
} from '@instagram-automation/contracts';

import type { SessionTokenHash } from '../security/session-token.js';
import type { ProtectedToken } from '../security/token-protector.js';
import type { RecoveryKind } from '../automation/recovery.js';

export type {
  DeliveryChannel,
  DeliveryMode,
  ExecutionStatus,
} from '@instagram-automation/contracts';

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

  /** Whether provider calls may proceed or the owner must reconnect Instagram. */
  connectionStatus: 'active' | 'reconnect_required';

  /** Safe application-owned reason for the latest refresh failure. */
  tokenRefreshFailureCode: string | null;

  /** Last instant at which Meta successfully refreshed this token. */
  tokenRefreshLastSucceededAt: Date | null;

  /** Earliest instant at which another refresh attempt may be made. */
  tokenRefreshNextAttemptAt: Date | null;

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

/** Expiring account leased by one maintenance invocation. */
export interface TokenRefreshClaim {
  /** Connected account containing the encrypted current token. */
  account: InstagramAccount;
  /** Opaque ownership token required to complete this refresh attempt. */
  leaseId: string;
}

/** Result of one failed provider token-refresh request. */
export interface TokenRefreshFailure {
  /** Stable safe error category. */
  errorCode: string;
  /** Whether only a new Instagram login can repair the connection. */
  reconnectRequired: boolean;
  /** Earliest time at which a temporary failure may be retried. */
  retryAt: Date | null;
}

/** Persistence used only by scheduled connection maintenance. */
export interface TokenRefreshRepository {
  /** Leases a bounded batch of active accounts whose tokens are nearing expiry. */
  claimExpiringAccounts(
    now: Date,
    expiresBefore: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<TokenRefreshClaim[]>;
  /** Atomically replaces a refreshed encrypted token when the caller still owns the lease. */
  completeTokenRefresh(
    accountId: string,
    leaseId: string,
    accessTokenCiphertext: ProtectedToken,
    tokenExpiresAt: Date,
    refreshedAt: Date,
  ): Promise<boolean>;
  /** Records a sanitized refresh failure and releases the caller's lease. */
  failTokenRefresh(
    accountId: string,
    leaseId: string,
    failure: TokenRefreshFailure,
  ): Promise<boolean>;
  /** Marks already-expired active connections as requiring a new Instagram login. */
  markExpiredAccountsReconnectRequired(now: Date): Promise<number>;
  /** Marks an account after Meta explicitly rejects its token during a reply. */
  markAccountReconnectRequired(accountId: string, errorCode: string): Promise<boolean>;
}

/** Safe aggregate counters produced by one completed maintenance pass. */
export interface MaintenanceCounts {
  /** Accounts found after credential expiry. */
  expiredTokenCount: number;
  /** Connections requiring owner reconnection. */
  reconnectRequiredCount: number;
  /** Reply attempts that reached terminal failure. */
  replyFailedCount: number;
  /** Reply attempts scheduled for controlled retry. */
  replyRetryPendingCount: number;
  /** Reply attempts confirmed successful. */
  replySucceededCount: number;
  /** Ambiguous reply attempts stopped for review. */
  replyUncertainCount: number;
  /** Expired processing leases resolved. */
  staleExecutionCount: number;
  /** Token refresh attempts deferred after temporary failure. */
  tokenRefreshFailedCount: number;
  /** Tokens successfully refreshed. */
  tokenRefreshedCount: number;
}

/** Durable scheduler state safe to expose to an authenticated owner. */
export interface MaintenanceHealth extends MaintenanceCounts {
  /** Database time used to calculate freshness without trusting the browser clock. */
  checkedAt: Date;
  /** Safe application-owned code for the latest failed invocation. */
  lastFailureCode: string | null;
  /** Latest time a maintenance invocation failed. */
  lastFailedAt: Date | null;
  /** Latest time a full maintenance pass completed. */
  lastSucceededAt: Date | null;
}

/** Persistence for the singleton scheduled-maintenance heartbeat. */
export interface MaintenanceHealthRepository {
  /** Loads the heartbeat with current database time, or `null` before the first recorded run. */
  getHealth(): Promise<MaintenanceHealth | null>;
  /** Records a sanitized invocation failure without erasing the previous successful heartbeat. */
  recordFailure(errorCode: string): Promise<void>;
  /** Records completion time and safe aggregate results for one full pass. */
  recordSuccess(counts: MaintenanceCounts): Promise<void>;
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

  /** Selected delivery channels for a matching comment. */
  deliveryMode: DeliveryMode;

  /** Configured private reply sent for a matching comment. */
  privateReplyText: string | null;

  /** Configured public reply sent for a matching comment. */
  replyText: string;

  /** Owner-configured hashtag matched case-insensitively after trimming. */
  triggerText: string;

  /** Time at which the automation row was last changed. */
  updatedAt: Date;
}

/** Owner-controlled values used to create or replace an account's automation configuration. */
export interface SaveAutomationInput {
  /** Internal account identifier that owns the automation. */
  accountId: string;

  /** Whether matching comments may currently trigger a reply. */
  enabled: boolean;

  /** Selected delivery channels for a matching comment. */
  deliveryMode: DeliveryMode;

  /** Opaque Instagram media identifier selected by the owner. */
  mediaId: string;

  /** Configured public reply sent for a matching comment. */
  replyText: string;

  /** Configured private reply sent for a matching comment. */
  privateReplyText: string | null;

  /** Owner-configured hashtag trigger. */
  triggerText: string;
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

/** Persisted result of claiming and processing one Instagram comment. */
export interface Execution {
  /** Internal automation identifier that processed the comment. */
  automationId: string;

  /** Original comment text used for exact trigger matching. */
  commentText: string;

  /** Instagram username when supplied by the normalized webhook event. */
  commenterUsername: string | null;

  /** Instagram-scoped commenter ID when supplied by Meta. */
  commenterInstagramId: string | null;

  /** Time at which processing first claimed the comment. */
  createdAt: Date;

  /** Stable sanitized failure category safe for internal API responses. */
  errorCode: string | null;

  /** Sanitized failure description that contains no secrets or raw provider response. */
  errorMessage: string | null;

  /** Internal immutable execution identifier. */
  id: string;

  /** Number of provider attempts already started for this comment. */
  attemptCount: number;

  /** Instant at which the current attempt crossed the provider dispatch boundary. */
  dispatchStartedAt: Date | null;

  /** Public comment or private reply provider boundary used for this execution. */
  deliveryChannel: DeliveryChannel;

  /** Stable internal failure class used by recovery policy. */
  failureKind: RecoveryKind | null;

  /** Opaque Instagram comment identifier used as the idempotency key. */
  instagramCommentId: string;

  /** Immutable message text used by initial delivery and controlled retries. */
  messageText: string;

  /** Opaque ownership token for the currently processing attempt. */
  leaseId: string | null;

  /** Time after which maintenance may recover an undispatched attempt. */
  leaseExpiresAt: Date | null;

  /** Earliest time at which a controlled retry may be claimed. */
  nextAttemptAt: Date | null;

  /** Meta reply identifier returned only after confirmed success. */
  providerReplyId: string | null;

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

  /** Instagram-scoped commenter ID when supplied by Meta. */
  commenterInstagramId: string | null;

  /** Delivery channel claimed independently for this comment. */
  deliveryChannel: DeliveryChannel;

  /** Opaque Instagram comment identifier used as the idempotency key. */
  instagramCommentId: string;

  /** Immutable message text for initial delivery and retries. */
  messageText: string;

  /** Expiry of the initial processing lease. */
  leaseExpiresAt: Date;
}

/** Sanitized failure values that are safe to persist and return through an internal API. */
export interface ExecutionFailure {
  /** Stable non-empty application-owned failure category. */
  errorCode: string;

  /** Non-empty description with secrets and raw provider details removed. */
  errorMessage: string;

  /** Stable recovery classification. */
  failureKind: RecoveryKind;
}

/** Execution plus protected account and reply data needed by maintenance. */
export interface ExecutionRetryClaim {
  /** Connected account ID used for reconnection state changes. */
  accountId: string;
  /** Encrypted provider token decrypted only immediately before dispatch. */
  accessTokenCiphertext: ProtectedToken;
  /** Connected professional account ID required by private replies. */
  instagramUserId: string;
  /** Leased execution. */
  execution: Execution;
}

/** Persistence operations required by idempotent comment processing and recent activity. */
export interface ExecutionRepository {
  /** Atomically claims every requested delivery channel for one comment. */
  claimExecutions(inputs: ClaimExecutionInput[]): Promise<Execution[]>;

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

  /** Leases safe due retries for active accounts and increments their attempt number. */
  claimDueRetries(now: Date, leaseUntil: Date, limit: number): Promise<ExecutionRetryClaim[]>;

  /** Resolves expired dispatched leases as uncertain and exhausted pre-dispatch leases as failed. */
  resolveStaleExecutions(now: Date): Promise<number>;

  /** Records the irreversible provider-dispatch boundary for the current lease owner. */
  markDispatchStarted(executionId: string, leaseId: string, at: Date): Promise<boolean>;

  /**
   * Completes a processing execution with sanitized failure information.
   *
   * @param executionId - Internal execution identifier.
   * @param failure - Non-empty application-owned and sanitized failure values.
   * @returns The failed execution, or `null` when it does not exist or is already terminal.
   */
  markFailed(
    executionId: string,
    leaseId: string,
    failure: ExecutionFailure,
  ): Promise<Execution | null>;

  /** Schedules a controlled retry for an explicitly retryable rejection. */
  markRetryPending(
    executionId: string,
    leaseId: string,
    failure: ExecutionFailure,
    retryAt: Date,
  ): Promise<Execution | null>;

  /** Stops automatic delivery after an ambiguous provider outcome. */
  markUncertain(
    executionId: string,
    leaseId: string,
    failure: ExecutionFailure,
  ): Promise<Execution | null>;

  /**
   * Completes a processing execution successfully.
   *
   * @param executionId - Internal execution identifier.
   * @returns The succeeded execution, or `null` when it does not exist or is already terminal.
   */
  markSucceeded(
    executionId: string,
    leaseId: string,
    providerReplyId: string,
  ): Promise<Execution | null>;
}
