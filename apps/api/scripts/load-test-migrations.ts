import { resolve } from 'node:path';

import {
  executeMigrationCommand,
  type MigrationCommand,
  MigrationConfigurationError,
  toSafeMigrationError,
} from './migration-runner.js';
import {
  LoadTestConfigurationError,
  requireIsolatedLoadTestDatabase,
  toSafeLoadTestError,
} from './load-testing/config.js';

const parseCommand = (value: string | undefined): MigrationCommand => {
  if (value === 'migrate' || value === 'status') return value;
  throw new MigrationConfigurationError('Migration command must be either migrate or status');
};

const main = async (): Promise<void> => {
  const databaseUrl = requireIsolatedLoadTestDatabase(
    process.env.LOAD_TEST_DATABASE_MIGRATION_URL,
    process.env.LOAD_TEST_CONFIRM_ISOLATED,
    [process.env.DATABASE_URL, process.env.DATABASE_MIGRATION_URL],
  );
  await executeMigrationCommand(
    parseCommand(process.argv[2]),
    databaseUrl,
    resolve(import.meta.dirname, '../../../db/migrations'),
  );
};

try {
  await main();
} catch (error) {
  console.error(
    error instanceof LoadTestConfigurationError
      ? toSafeLoadTestError(error)
      : toSafeMigrationError(error),
  );
  process.exitCode = 1;
}
