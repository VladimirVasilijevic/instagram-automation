import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import path from 'node:path';

import { parseEnvironment } from '../../../../apps/api/src/config/environment.ts';

const requiredVariables = [
  'APP_BASE_URL',
  'DATABASE_URL',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_API_VERSION',
  'META_REDIRECT_URI',
  'SESSION_COOKIE_NAME',
  'SESSION_TTL_SECONDS',
  'TOKEN_ENCRYPTION_KEY',
] as const;

const usage = `Usage: check-config.ts [environment-file]

Validate Instagram Login configuration without printing configured values.
The environment file defaults to .env.local at the repository root.`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage);
  process.exit(0);
}

if (process.argv.length > 3) {
  console.error(usage);
  process.exit(2);
}

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const requestedPath = process.argv[2] ?? '.env.local';
const environmentPath = path.resolve(repositoryRoot, requestedPath);

if (!existsSync(environmentPath)) {
  console.error(`Environment file not found: ${requestedPath}`);
  process.exit(2);
}

let input: NodeJS.ProcessEnv;
try {
  input = parseEnv(readFileSync(environmentPath, 'utf8'));
} catch {
  console.error(`Environment file could not be parsed: ${requestedPath}`);
  process.exit(1);
}

let missing = false;
for (const variable of requiredVariables) {
  const present = typeof input[variable] === 'string' && input[variable].trim().length > 0;
  console.log(`${present ? 'PRESENT' : 'MISSING'} ${variable}`);
  missing ||= !present;
}

if (missing) {
  console.error('Configuration is incomplete.');
  process.exit(1);
}

try {
  const configuration = parseEnvironment(input);
  const originsMatch =
    new URL(configuration.APP_BASE_URL).origin === new URL(configuration.META_REDIRECT_URI).origin;

  console.log('VALID application environment schema');
  console.log(`${originsMatch ? 'VALID' : 'INVALID'} OAuth callback origin`);

  if (!originsMatch) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown validation failure';
  console.error(message);
  process.exitCode = 1;
}
