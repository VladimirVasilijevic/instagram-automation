import postgres from 'postgres';

import type { OAuthStateRepository } from '../security/oauth-state.js';
import { createAsyncOperationGate, serializeAsyncMethods } from './operation-gate.js';
import { createPostgresOAuthStateRepository } from './postgres-oauth-states.js';

import {
  createPostgresAccountRepository,
  createPostgresAutomationRepository,
  createPostgresExecutionRepository,
  createPostgresMaintenanceHealthRepository,
  createPostgresSessionRepository,
  createPostgresTokenRefreshRepository,
} from './postgres-repositories.js';
import type {
  AccountRepository,
  AutomationRepository,
  ExecutionRepository,
  MaintenanceHealthRepository,
  SessionRepository,
  TokenRefreshRepository,
} from './repositories.js';

/** Minimal database capability required by an API health check. */
export interface DatabaseHealthChecker {
  /**
   * Runs a minimal query to confirm database connectivity.
   *
   * @throws When PostgreSQL cannot be reached or rejects the query.
   */
  checkHealth(): Promise<void>;
}

/** Runtime PostgreSQL connection with health-check and shutdown capabilities. */
export interface Database extends DatabaseHealthChecker {
  /** Single-use, expiring OAuth attempts shared across application instances. */
  oauthStateRepository: OAuthStateRepository;
  /** PostgreSQL-backed connected-account persistence. */
  accountRepository: AccountRepository;

  /** PostgreSQL-backed automation configuration persistence. */
  automationRepository: AutomationRepository;

  /** Closes the underlying Postgres.js connections. */
  close(): Promise<void>;

  /** PostgreSQL-backed application-session persistence. */
  sessionRepository: SessionRepository;

  /** PostgreSQL-backed execution and recent-activity persistence. */
  executionRepository: ExecutionRepository;

  /** PostgreSQL-backed expiring-token maintenance persistence. */
  tokenRefreshRepository: TokenRefreshRepository;

  /** Durable scheduled-maintenance heartbeat persistence. */
  maintenanceHealthRepository: MaintenanceHealthRepository;
}

/**
 * Creates a serverless-friendly Postgres.js connection wrapper.
 *
 * @param connectionString - Server-only PostgreSQL transaction-pooler URL.
 * @returns Database operations used by the API process.
 */
export const createDatabase = (connectionString: string): Database => {
  const sql = postgres(connectionString, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const operationGate = createAsyncOperationGate();

  return {
    oauthStateRepository: serializeAsyncMethods(
      createPostgresOAuthStateRepository(sql),
      operationGate,
    ),
    accountRepository: serializeAsyncMethods(createPostgresAccountRepository(sql), operationGate),
    automationRepository: serializeAsyncMethods(
      createPostgresAutomationRepository(sql),
      operationGate,
    ),
    checkHealth: () =>
      operationGate.run(async () => {
        await sql`select 1`;
      }),
    close: () => operationGate.run(async () => sql.end({ timeout: 5 })),
    executionRepository: serializeAsyncMethods(
      createPostgresExecutionRepository(sql),
      operationGate,
    ),
    maintenanceHealthRepository: serializeAsyncMethods(
      createPostgresMaintenanceHealthRepository(sql),
      operationGate,
    ),
    sessionRepository: serializeAsyncMethods(createPostgresSessionRepository(sql), operationGate),
    tokenRefreshRepository: serializeAsyncMethods(
      createPostgresTokenRefreshRepository(sql),
      operationGate,
    ),
  };
};
