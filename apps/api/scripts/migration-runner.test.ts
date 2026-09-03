import { describe, expect, it, vi } from 'vitest';

import {
  calculateMigrationChecksum,
  determineMigrationState,
  executeMigrationCommand,
  type Migration,
  type MigrationBackend,
  type MigrationCommandDependencies,
  MigrationConfigurationError,
  MigrationIntegrityError,
  toSafeMigrationError,
  validateMigrationFilenames,
} from './migration-runner.js';

const createMigration = (filename: string, sql = 'select 1;'): Migration => ({
  checksum: calculateMigrationChecksum(sql),
  filename,
  sql,
});

const createBackend = (overrides: Partial<MigrationBackend> = {}): MigrationBackend => ({
  applyMigrations: vi.fn().mockResolvedValue([]),
  close: vi.fn().mockResolvedValue(undefined),
  getAppliedMigrations: vi.fn().mockResolvedValue([]),
  ...overrides,
});

const createDependencies = (
  backend: MigrationBackend,
  migrations: Migration[],
): MigrationCommandDependencies => ({
  createBackend: vi.fn().mockReturnValue(backend),
  loadMigrations: vi.fn().mockResolvedValue(migrations),
  writeLine: vi.fn(),
});

describe('migration integrity', () => {
  it('produces a stable SHA-256 checksum', () => {
    expect(calculateMigrationChecksum('select 1;')).toBe(
      '354b7196c9ba5fb4b21cf615bb6ec4cd5c07503c34229feef033fc081a8c03f4',
    );
  });

  it('splits an applied prefix from pending migrations', () => {
    const firstMigration = createMigration('0001_initial_schema.sql');
    const secondMigration = createMigration('0002_add_index.sql');

    expect(
      determineMigrationState(
        [firstMigration, secondMigration],
        [{ checksum: firstMigration.checksum, filename: firstMigration.filename }],
      ),
    ).toEqual({ applied: [firstMigration], pending: [secondMigration] });
  });

  it('rejects an edited applied migration', () => {
    const migration = createMigration('0001_initial_schema.sql');

    expect(() =>
      determineMigrationState(
        [migration],
        [{ checksum: calculateMigrationChecksum('changed'), filename: migration.filename }],
      ),
    ).toThrowError(/checksum changed/);
  });

  it('rejects a missing or out-of-order applied migration', () => {
    const secondMigration = createMigration('0002_add_index.sql');

    expect(() =>
      determineMigrationState(
        [secondMigration],
        [{ checksum: secondMigration.checksum, filename: '0001_initial_schema.sql' }],
      ),
    ).toThrowError(/missing or out of order/);
  });

  it('rejects an invalid filename from the database ledger', () => {
    expect(() =>
      determineMigrationState([], [{ checksum: 'a'.repeat(64), filename: 'unsafe-name' }]),
    ).toThrowError(/invalid filename/);
  });

  it('rejects invalid local filenames and duplicate numeric versions', () => {
    expect(() => validateMigrationFilenames(['initial.sql'])).toThrowError(/Invalid migration/);
    expect(() =>
      validateMigrationFilenames(['0001_initial.sql', '0001_duplicate.sql']),
    ).toThrowError(/Duplicate migration version/);
  });
});

describe('migration command', () => {
  it('reports pending migration status and closes the connection', async () => {
    const migration = createMigration('0001_initial_schema.sql');
    const backend = createBackend();
    const dependencies = createDependencies(backend, [migration]);

    await executeMigrationCommand('status', 'secret-url', '/migrations', dependencies);

    expect(dependencies.writeLine).toHaveBeenCalledWith('Applied migrations: 0');
    expect(dependencies.writeLine).toHaveBeenCalledWith('Pending migrations: 1');
    expect(dependencies.writeLine).toHaveBeenCalledWith('pending 0001_initial_schema.sql');
    expect(backend.close).toHaveBeenCalledOnce();
  });

  it('reports migrations applied by the backend', async () => {
    const migration = createMigration('0001_initial_schema.sql');
    const backend = createBackend({
      applyMigrations: vi.fn().mockResolvedValue([migration.filename]),
    });
    const dependencies = createDependencies(backend, [migration]);

    await executeMigrationCommand('migrate', 'secret-url', '/migrations', dependencies);

    expect(dependencies.writeLine).toHaveBeenCalledWith('applied 0001_initial_schema.sql');
    expect(backend.close).toHaveBeenCalledOnce();
  });

  it('closes the connection when the database operation fails', async () => {
    const backend = createBackend({
      applyMigrations: vi.fn().mockRejectedValue(new Error('database failure with secret-url')),
    });
    const dependencies = createDependencies(backend, []);

    await expect(
      executeMigrationCommand('migrate', 'secret-url', '/migrations', dependencies),
    ).rejects.toThrowError(/database failure/);
    expect(backend.close).toHaveBeenCalledOnce();
  });

  it('sanitizes unexpected errors while preserving safe integrity errors', () => {
    expect(toSafeMigrationError(new Error('database failure with secret-url'))).toBe(
      'Database migration command failed (Error)',
    );
    expect(toSafeMigrationError(new MigrationIntegrityError('Migration checksum changed'))).toBe(
      'Migration checksum changed',
    );
    expect(
      toSafeMigrationError(new MigrationConfigurationError('DATABASE_MIGRATION_URL is required')),
    ).toBe('DATABASE_MIGRATION_URL is required');
  });
});
