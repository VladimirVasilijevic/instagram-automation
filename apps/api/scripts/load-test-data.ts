import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import postgres from 'postgres';

import { createDatabase } from '../src/database/database.js';
import { AesGcmTokenProtector } from '../src/security/aes-gcm-token-protector.js';
import { createSessionToken } from '../src/security/session-token.js';
import {
  LoadTestConfigurationError,
  loadTestAppSecret,
  loadTestBaseUrl,
  loadTestEncryptionKey,
  loadTestRunId,
  loadTestSessionCookieName,
  requireIsolatedLoadTestDatabase,
  toSafeLoadTestError,
} from './load-testing/config.js';

type Command = 'cleanup' | 'setup' | 'verify';

interface GeneratedConfiguration {
  accountInstagramId: string;
  appSecret: string;
  baseUrl: string;
  mediaId: string;
  runId: string;
  sessionCookie: string;
  triggerText: string;
}

const generatedConfigurationPath = resolve(
  import.meta.dirname,
  '../../../load-tests/.generated/config.json',
);

const command = (value: string | undefined): Command => {
  if (value === 'cleanup' || value === 'setup' || value === 'verify') return value;
  throw new Error('Load-test data command must be cleanup, setup, or verify');
};

const databaseUrl = (): string =>
  requireIsolatedLoadTestDatabase(
    process.env.LOAD_TEST_DATABASE_URL,
    process.env.LOAD_TEST_CONFIRM_ISOLATED,
    [process.env.DATABASE_URL, process.env.DATABASE_MIGRATION_URL],
  );

const readGeneratedConfiguration = async (): Promise<GeneratedConfiguration> => {
  const configuration = JSON.parse(
    await readFile(generatedConfigurationPath, 'utf8'),
  ) as GeneratedConfiguration;
  const runId = loadTestRunId(configuration.runId);
  if (
    configuration.accountInstagramId !== `loadtest-account-${runId}` ||
    configuration.mediaId !== `loadtest-media-${runId}`
  ) {
    throw new LoadTestConfigurationError('Generated fixture identifiers are invalid');
  }
  loadTestBaseUrl(configuration.baseUrl);
  return configuration;
};

const setup = async (): Promise<void> => {
  const runId = loadTestRunId(process.env.LOAD_TEST_RUN_ID);
  const database = createDatabase(databaseUrl());
  try {
    const tokenProtector = new AesGcmTokenProtector(loadTestEncryptionKey);
    const instagramUserId = `loadtest-account-${runId}`;
    const mediaId = `loadtest-media-${runId}`;
    const account = await database.accountRepository.upsertConnectedAccount({
      accessTokenCiphertext: tokenProtector.encrypt('synthetic-provider-token'),
      instagramUserId,
      tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      username: `loadtest_${runId.replaceAll('-', '_')}`,
    });
    await database.automationRepository.saveAutomation({
      accountId: account.id,
      deliveryMode: 'both',
      enabled: true,
      mediaId,
      privateReplyText: 'Synthetic private reply',
      replyText: 'Synthetic public reply',
      triggerText: '#LoadTest',
    });
    const session = createSessionToken();
    await database.sessionRepository.createSession({
      accountId: account.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenHash: session.tokenHash,
    });
    const configuration: GeneratedConfiguration = {
      accountInstagramId: instagramUserId,
      appSecret: loadTestAppSecret,
      baseUrl: loadTestBaseUrl(process.env.LOAD_TEST_BASE_URL),
      mediaId,
      runId,
      sessionCookie: `${loadTestSessionCookieName}=${session.token}`,
      triggerText: '#LoadTest',
    };
    await mkdir(dirname(generatedConfigurationPath), { recursive: true });
    await writeFile(generatedConfigurationPath, `${JSON.stringify(configuration, null, 2)}\n`, {
      mode: 0o600,
    });
    console.info(`Created isolated fixtures for ${runId}`);
  } finally {
    await database.close();
  }
};

const withSql = async <T>(
  operation: (sql: ReturnType<typeof postgres>) => Promise<T>,
): Promise<T> => {
  const sql = postgres(databaseUrl(), {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  try {
    return await operation(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const verify = async (): Promise<void> => {
  const configuration = await readGeneratedConfiguration();
  const result = await withSql(async (sql) => {
    const statusCounts = await sql<{ delivery_channel: string; status: string; count: number }[]>`
      select execution.delivery_channel, execution.status, count(*)::integer as count
      from app_private.executions as execution
      inner join app_private.automations as automation on automation.id = execution.automation_id
      inner join app_private.instagram_accounts as account on account.id = automation.account_id
      where account.instagram_user_id = ${configuration.accountInstagramId}
      group by execution.delivery_channel, execution.status
      order by execution.delivery_channel, execution.status
    `;
    const duplicates = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from (
        select execution.instagram_comment_id, execution.delivery_channel
        from app_private.executions as execution
        inner join app_private.automations as automation on automation.id = execution.automation_id
        inner join app_private.instagram_accounts as account on account.id = automation.account_id
        where account.instagram_user_id = ${configuration.accountInstagramId}
        group by execution.instagram_comment_id, execution.delivery_channel
        having count(*) > 1
      ) as duplicate
    `;
    const processing = statusCounts
      .filter((row) => row.status === 'processing')
      .reduce((total, row) => total + row.count, 0);
    return { duplicateCount: duplicates[0]?.count ?? 0, processingCount: processing, statusCounts };
  });
  console.info(JSON.stringify({ runId: configuration.runId, ...result }, null, 2));
  if (result.duplicateCount !== 0 || result.processingCount !== 0) process.exitCode = 1;
};

const cleanup = async (): Promise<void> => {
  const configuration = await readGeneratedConfiguration();
  const removed = await withSql((sql) =>
    sql.begin(async (transaction) => {
      const accountRows = await transaction<{ id: string }[]>`
        select id from app_private.instagram_accounts
        where instagram_user_id = ${configuration.accountInstagramId}
      `;
      const accountIds = accountRows.map((row) => row.id);
      if (accountIds.length === 0)
        return { accounts: 0, automations: 0, executions: 0, sessions: 0 };
      const executions = await transaction<{ id: string }[]>`
        delete from app_private.executions
        where automation_id in (
          select id from app_private.automations where account_id in ${sql(accountIds)}
        )
        returning id
      `;
      const automations = await transaction<{ id: string }[]>`
        delete from app_private.automations where account_id in ${sql(accountIds)} returning id
      `;
      const sessions = await transaction<{ id: string }[]>`
        delete from app_private.sessions where account_id in ${sql(accountIds)} returning id
      `;
      const accounts = await transaction<{ id: string }[]>`
        delete from app_private.instagram_accounts
        where id in ${sql(accountIds)} and instagram_user_id = ${configuration.accountInstagramId}
        returning id
      `;
      return {
        accounts: accounts.length,
        automations: automations.length,
        executions: executions.length,
        sessions: sessions.length,
      };
    }),
  );
  await unlink(generatedConfigurationPath);
  console.info(JSON.stringify({ runId: configuration.runId, removed }, null, 2));
};

const main = async (): Promise<void> => {
  const selectedCommand = command(process.argv[2]);
  if (selectedCommand === 'setup') await setup();
  if (selectedCommand === 'verify') await verify();
  if (selectedCommand === 'cleanup') await cleanup();
};

try {
  await main();
} catch (error) {
  console.error(toSafeLoadTestError(error));
  process.exitCode = 1;
}
