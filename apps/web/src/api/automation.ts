/** The single fixed-trigger automation configured by the signed-in account. */
export interface Automation {
  /** Whether a matching comment may trigger a reply. */
  enabled: boolean;
  /** Selected Instagram media identifier. */
  mediaId: string;
  /** Reply text posted for the fixed trigger. */
  replyText: string;
  /** Fixed trigger supported by this first vertical slice. */
  triggerText: '#Hello';
}

/** Owner-controlled values submitted when saving the automation. */
export interface SaveAutomationInput {
  enabled: boolean;
  mediaId: string;
  replyText: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const request = async (
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> => {
  try {
    const deadline = AbortSignal.timeout(10_000);
    return await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json', ...init.headers },
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch (error) {
    throw new Error('Automation service is unavailable. Please try again.', { cause: error });
  }
};

const readAutomation = (value: unknown): Automation => {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.mediaId !== 'string' ||
    value.mediaId.trim() === '' ||
    typeof value.replyText !== 'string' ||
    value.replyText.trim() === '' ||
    value.triggerText !== '#Hello'
  ) {
    throw new Error('Invalid automation');
  }
  return {
    enabled: value.enabled,
    mediaId: value.mediaId,
    replyText: value.replyText,
    triggerText: value.triggerText,
  };
};

const readPayload = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    throw new Error('Automation service returned an invalid response. Please try again.', {
      cause: error,
    });
  }
};

/** Loads the saved automation, or null when the signed-in account has not configured one. */
export const getAutomation = async (signal?: AbortSignal): Promise<Automation | null> => {
  const response = await request('/api/automation', {}, signal);
  if (!response.ok) throw new Error('Automation service is unavailable. Please try again.');
  const payload = await readPayload(response);
  if (!isRecord(payload) || !('automation' in payload))
    throw new Error('Automation service returned an invalid response. Please try again.');
  if (payload.automation === null) return null;
  try {
    return readAutomation(payload.automation);
  } catch (error) {
    throw new Error('Automation service returned an invalid response. Please try again.', {
      cause: error,
    });
  }
};

/** Creates or replaces the signed-in account automation through the same-origin API. */
export const saveAutomation = async (input: SaveAutomationInput): Promise<Automation> => {
  const response = await request('/api/automation', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Automation settings could not be saved. Please try again.');
  const payload = await readPayload(response);
  if (!isRecord(payload) || !('automation' in payload))
    throw new Error('Automation service returned an invalid response. Please try again.');
  try {
    return readAutomation(payload.automation);
  } catch (error) {
    throw new Error('Automation service returned an invalid response. Please try again.', {
      cause: error,
    });
  }
};
