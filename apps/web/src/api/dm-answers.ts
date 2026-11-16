import { isExecutionStatus, type ExecutionStatus } from '@instagram-automation/contracts';

export interface DmAnswerActivity {
  choiceTitle: string | null;
  commenterUsername: string | null;
  followupStatus: 'pending' | ExecutionStatus | null;
  mediaId: string | null;
  receivedAt: string;
  typedText: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const readAnswer = (value: unknown): DmAnswerActivity => {
  if (
    !isRecord(value) ||
    !isNullableString(value.choiceTitle) ||
    !isNullableString(value.commenterUsername) ||
    !isNullableString(value.mediaId) ||
    !isNullableString(value.typedText) ||
    typeof value.receivedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.receivedAt)) ||
    (value.followupStatus !== null &&
      value.followupStatus !== 'pending' &&
      !isExecutionStatus(value.followupStatus))
  )
    throw new Error('Invalid DM answer');
  return {
    choiceTitle: value.choiceTitle,
    commenterUsername: value.commenterUsername,
    followupStatus: value.followupStatus,
    mediaId: value.mediaId,
    receivedAt: value.receivedAt,
    typedText: value.typedText,
  };
};

/** Lists recent account-owned answers without exposing Instagram-scoped IDs. */
export const getRecentDmAnswers = async (
  signal?: AbortSignal,
  mediaId?: string,
): Promise<DmAnswerActivity[]> => {
  let response: Response;
  try {
    const deadline = AbortSignal.timeout(10_000);
    const query = mediaId ? `?${new URLSearchParams({ mediaId })}` : '';
    response = await fetch(`/api/dm-answers${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch (error) {
    throw new Error('DM answers are unavailable. Please try again.', { cause: error });
  }
  if (!response.ok) throw new Error('DM answers are unavailable. Please try again.');
  try {
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.answers) || payload.answers.length > 50)
      throw new Error('Invalid DM answers list');
    return payload.answers.map(readAnswer);
  } catch (error) {
    throw new Error('DM answers returned an invalid response. Please try again.', { cause: error });
  }
};
