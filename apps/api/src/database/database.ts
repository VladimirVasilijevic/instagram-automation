import postgres from 'postgres';

import {
  createPostgresAccountRepository,
  createPostgresAutomationRepository,
  createPostgresExecutionRepository,
  createPostgresSessionRepository,
} from './postgres-repositories.js';
import type {
  AccountRepository,
  AutomationRepository,
  ExecutionRepository,
  SessionRepository,
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

  return {
    accountRepository: createPostgresAccountRepository(sql),
    automationRepository: createPostgresAutomationRepository(sql),
    async checkHealth(): Promise<void> {
      await sql`select 1`;
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
    executionRepository: createPostgresExecutionRepository(sql),
    sessionRepository: createPostgresSessionRepository(sql),
  };
};
