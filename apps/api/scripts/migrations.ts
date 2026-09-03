import { resolve } from 'node:path';

import {
  executeMigrationCommand,
  type MigrationCommand,
  MigrationConfigurationError,
  toSafeMigrationError,
} from './migration-runner.js';

const parseCommand = (value: string | undefined): MigrationCommand => {
  if (value === 'migrate' || value === 'status') {
    return value;
  }

  throw new MigrationConfigurationError('Migration command must be either migrate or status');
};

const parseDatabaseUrl = (value: string | undefined): string => {
  if (!value?.trim()) {
    throw new MigrationConfigurationError('DATABASE_MIGRATION_URL is required');
  }

  return value;
};

const main = async (): Promise<void> => {
  const command = parseCommand(process.argv[2]);
  const databaseUrl = parseDatabaseUrl(process.env.DATABASE_MIGRATION_URL);
  const migrationsDirectory = resolve(import.meta.dirname, '../../../db/migrations');

  await executeMigrationCommand(command, databaseUrl, migrationsDirectory);
};

try {
  await main();
} catch (error) {
  console.error(toSafeMigrationError(error));
  process.exitCode = 1;
}
