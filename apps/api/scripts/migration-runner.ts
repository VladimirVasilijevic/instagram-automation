import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import postgres from 'postgres';

const migrationFilenamePattern = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const migrationLockNamespace = 49_331;
const migrationLockIdentifier = 2;

/** Supported database-migration commands. */
export type MigrationCommand = 'migrate' | 'status';

/** Versioned SQL migration loaded from the repository. */
export interface Migration {
  /** SHA-256 checksum of the exact SQL file contents. */
  checksum: string;

  /** Ordered migration filename. */
  filename: string;

  /** SQL statements executed when the migration is pending. */
  sql: string;
}

/** Migration previously recorded in the database ledger. */
export interface AppliedMigration {
  /** SHA-256 checksum recorded when the migration was applied. */
  checksum: string;

  /** Applied migration filename. */
  filename: string;
}

/** Validated relationship between repository migrations and the database ledger. */
export interface MigrationState {
  /** Local migrations already recorded by the database. */
  applied: Migration[];

  /** Local migrations that have not been applied. */
  pending: Migration[];
}

/** Database operations required by the migration command. */
export interface MigrationBackend {
  /** Applies every pending migration under a database lock and returns applied filenames. */
  applyMigrations(migrations: Migration[]): Promise<string[]>;

  /** Closes the migration database connection. */
  close(): Promise<void>;

  /** Reads applied migrations without changing database state. */
  getAppliedMigrations(): Promise<AppliedMigration[]>;
}

/** Injectable dependencies used by the migration command and its tests. */
export interface MigrationCommandDependencies {
  /** Creates the database-specific migration backend. */
  createBackend(databaseUrl: string): MigrationBackend;

  /** Loads versioned SQL migrations from the supplied directory. */
  loadMigrations(directory: string): Promise<Migration[]>;

  /** Writes one safe status line to command output. */
  writeLine(line: string): void;
}

/** Error raised when local migration history differs from the database ledger. */
export class MigrationIntegrityError extends Error {
  /** Creates a migration-integrity failure with a credential-free message. */
  constructor(message: string) {
    super(message);
    this.name = 'MigrationIntegrityError';
  }
}

/** Error raised when required migration command configuration is invalid. */
export class MigrationConfigurationError extends Error {
  /** Creates a credential-free migration configuration failure. */
  constructor(message: string) {
    super(message);
    this.name = 'MigrationConfigurationError';
  }
}

/** Calculates the lowercase SHA-256 checksum used by the migration ledger. */
export const calculateMigrationChecksum = (sql: string): string =>
  createHash('sha256').update(sql, 'utf8').digest('hex');

/** Validates migration filenames and rejects duplicate numeric versions. */
export const validateMigrationFilenames = (filenames: string[]): void => {
  const versions = new Set<string>();

  for (const filename of filenames) {
    const match = migrationFilenamePattern.exec(filename);

    if (!match) {
      throw new MigrationIntegrityError(`Invalid migration filename: ${JSON.stringify(filename)}`);
    }

    const version = match[1] ?? '';

    if (versions.has(version)) {
      throw new MigrationIntegrityError(`Duplicate migration version: ${version}`);
    }

    versions.add(version);
  }
};

/**
 * Loads and validates ordered SQL migration files.
 *
 * @param directory - Absolute path containing versioned migration files.
 * @returns Validated migrations in filename order.
 */
export const loadMigrations = async (directory: string): Promise<Migration[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  validateMigrationFilenames(filenames);

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(join(directory, filename), 'utf8');

      if (sql.trim().length === 0) {
        throw new MigrationIntegrityError(`Migration is empty: ${JSON.stringify(filename)}`);
      }

      return { checksum: calculateMigrationChecksum(sql), filename, sql };
    }),
  );
};

/**
 * Validates applied migration history and returns its applied and pending prefix split.
 *
 * @param migrations - Ordered migrations loaded from the repository.
 * @param appliedMigrations - Migration records read from the database.
 * @returns Applied and pending local migrations.
 */
export const determineMigrationState = (
  migrations: Migration[],
  appliedMigrations: AppliedMigration[],
): MigrationState => {
  const sortedAppliedMigrations = [...appliedMigrations].sort((left, right) =>
    left.filename.localeCompare(right.filename),
  );

  for (const [index, appliedMigration] of sortedAppliedMigrations.entries()) {
    const localMigration = migrations[index];

    if (!migrationFilenamePattern.test(appliedMigration.filename)) {
      throw new MigrationIntegrityError('Database migration ledger contains an invalid filename');
    }

    if (!localMigration || localMigration.filename !== appliedMigration.filename) {
      throw new MigrationIntegrityError(
        `Applied migration is missing or out of order: ${JSON.stringify(appliedMigration.filename)}`,
      );
    }

    if (localMigration.checksum !== appliedMigration.checksum) {
      throw new MigrationIntegrityError(
        `Applied migration checksum changed: ${JSON.stringify(appliedMigration.filename)}`,
      );
    }
  }

  return {
    applied: migrations.slice(0, sortedAppliedMigrations.length),
    pending: migrations.slice(sortedAppliedMigrations.length),
  };
};

const readAppliedMigrations = async (
  sql: ReturnType<typeof postgres>,
): Promise<AppliedMigration[]> => {
  const ledgerResult = await sql<{ ledger_name: string | null }[]>`
    select to_regclass('app_private.schema_migrations')::text as ledger_name
  `;

  if (!ledgerResult[0]?.ledger_name) {
    return [];
  }

  return sql<AppliedMigration[]>`
    select filename, checksum
    from app_private.schema_migrations
    order by filename
  `;
};

const createPostgresMigrationBackend = (databaseUrl: string): MigrationBackend => {
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });

  return {
    async applyMigrations(migrations): Promise<string[]> {
      return sql.begin(async (transactionSql) => {
        const lockResult = await transactionSql<{ acquired: boolean }[]>`
          select pg_try_advisory_xact_lock(
            ${migrationLockNamespace},
            ${migrationLockIdentifier}
          ) as acquired
        `;

        if (!lockResult[0]?.acquired) {
          throw new MigrationIntegrityError('Another migration command is already running');
        }

        await transactionSql`create schema if not exists app_private`;
        await transactionSql`revoke all on schema app_private from public`;
        await transactionSql`
          create table if not exists app_private.schema_migrations (
            filename text primary key,
            checksum text not null
              constraint schema_migrations_checksum_format
              check (checksum ~ '^[0-9a-f]{64}$'),
            applied_at timestamptz not null default now()
          )
        `;
        await transactionSql`revoke all on app_private.schema_migrations from public`;
        await transactionSql`alter table app_private.schema_migrations enable row level security`;

        const appliedMigrations = await transactionSql<AppliedMigration[]>`
          select filename, checksum
          from app_private.schema_migrations
          order by filename
        `;
        const { pending } = determineMigrationState(migrations, appliedMigrations);

        for (const migration of pending) {
          await transactionSql.unsafe(migration.sql);
          await transactionSql`
            insert into app_private.schema_migrations (filename, checksum)
            values (${migration.filename}, ${migration.checksum})
          `;
        }

        return pending.map((migration) => migration.filename);
      });
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
    async getAppliedMigrations(): Promise<AppliedMigration[]> {
      return readAppliedMigrations(sql);
    },
  };
};

const defaultDependencies: MigrationCommandDependencies = {
  createBackend: createPostgresMigrationBackend,
  loadMigrations,
  writeLine: (line) => console.log(line),
};

/**
 * Executes a migration or status command and always closes its database connection.
 *
 * @param command - Migration operation to perform.
 * @param databaseUrl - Privileged PostgreSQL migration connection string.
 * @param migrationsDirectory - Absolute path to versioned SQL migrations.
 * @param dependencies - Injectable filesystem, database, and output dependencies.
 */
export const executeMigrationCommand = async (
  command: MigrationCommand,
  databaseUrl: string,
  migrationsDirectory: string,
  dependencies: MigrationCommandDependencies = defaultDependencies,
): Promise<void> => {
  const migrations = await dependencies.loadMigrations(migrationsDirectory);
  const backend = dependencies.createBackend(databaseUrl);

  try {
    if (command === 'status') {
      const appliedMigrations = await backend.getAppliedMigrations();
      const state = determineMigrationState(migrations, appliedMigrations);

      dependencies.writeLine(`Applied migrations: ${state.applied.length}`);
      dependencies.writeLine(`Pending migrations: ${state.pending.length}`);

      for (const migration of state.pending) {
        dependencies.writeLine(`pending ${migration.filename}`);
      }

      return;
    }

    const appliedFilenames = await backend.applyMigrations(migrations);

    if (appliedFilenames.length === 0) {
      dependencies.writeLine('No pending migrations.');
      return;
    }

    for (const filename of appliedFilenames) {
      dependencies.writeLine(`applied ${filename}`);
    }
  } finally {
    await backend.close();
  }
};

/** Converts an internal migration failure into credential-free command output. */
export const toSafeMigrationError = (error: unknown): string => {
  if (error instanceof MigrationIntegrityError || error instanceof MigrationConfigurationError) {
    return error.message;
  }

  const errorName = error instanceof Error ? error.name : 'UnknownError';

  return `Database migration command failed (${errorName})`;
};
