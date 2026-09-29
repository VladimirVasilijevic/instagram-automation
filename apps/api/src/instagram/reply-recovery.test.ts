import { describe, expect, it } from 'vitest';

import { classifyInstagramReplyFailure } from './reply-recovery.js';

describe('Instagram reply recovery policy', () => {
  it.each([
    [{ reason: 'http_error' as const, httpStatus: 401 }, 'authentication'],
    [{ reason: 'http_error' as const, httpStatus: 400, metaErrorCode: 190 }, 'authentication'],
    [{ reason: 'http_error' as const, httpStatus: 429 }, 'retryable'],
    [{ reason: 'http_error' as const, httpStatus: 403, metaErrorCode: 10 }, 'permanent'],
    [{ reason: 'http_error' as const, httpStatus: 400 }, 'permanent'],
    [{ reason: 'http_error' as const, httpStatus: 500 }, 'uncertain'],
    [{ reason: 'timeout' as const }, 'uncertain'],
    [{ reason: 'network_error' as const }, 'uncertain'],
  ])('classifies %j as %s', (diagnostics, expected) => {
    expect(classifyInstagramReplyFailure(diagnostics)).toBe(expected);
  });
});
