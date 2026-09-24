/** Safe automation activity returned for the signed-in account. */
export interface ExecutionActivity {
  /** Instagram username when available in the comment event. */
  commenterUsername: string | null;
  /** Original comment text. */
  commentText: string;
  /** ISO-8601 time when processing claimed the comment. */
  createdAt: string;
  /** Safe app-owned failure category, when processing failed. */
  errorCode: string | null;
  /** Safe app-owned failure description, when processing failed. */
  errorMessage: string | null;
  /** Current processing result. */
  status: 'failed' | 'processing' | 'succeeded';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const readExecution = (value: unknown): ExecutionActivity => {
  if (
    !isRecord(value) ||
    !isNullableString(value.commenterUsername) ||
    typeof value.commentText !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !isNullableString(value.errorCode) ||
    !isNullableString(value.errorMessage) ||
    !['failed', 'processing', 'succeeded'].includes(String(value.status))
  ) {
    throw new Error('Invalid activity');
  }
  return {
    commenterUsername: value.commenterUsername,
    commentText: value.commentText,
    createdAt: value.createdAt,
    errorCode: value.errorCode,
    errorMessage: value.errorMessage,
    status: value.status as ExecutionActivity['status'],
  };
};

/** Loads up to fifty safe activity records using the existing same-origin application session. */
export const getRecentExecutions = async (signal?: AbortSignal): Promise<ExecutionActivity[]> => {
  let response: Response;
  try {
    const deadline = AbortSignal.timeout(10_000);
    response = await fetch('/api/executions?limit=50', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch (error) {
    throw new Error('Activity is unavailable. Please try again.', { cause: error });
  }
  if (!response.ok) throw new Error('Activity is unavailable. Please try again.');
  try {
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.executions) || payload.executions.length > 50)
      throw new Error('Invalid activity list');
    return payload.executions.map(readExecution);
  } catch (error) {
    throw new Error('Activity returned an invalid response. Please try again.', { cause: error });
  }
};
