import { runHttpLoadSuite } from './load-testing/http-suite.js';
import { toSafeLoadTestError } from './load-testing/config.js';

runHttpLoadSuite().catch((error: unknown) => {
  console.error(toSafeLoadTestError(error));
  if (error instanceof Error && error.name === 'AssertionError') console.error(error.message);
  process.exitCode = 1;
});
