import { DELIVERY_MODE, isDeliveryMode, type DeliveryMode } from '@instagram-automation/contracts';

export type { DeliveryMode } from '@instagram-automation/contracts';

/** The single comment automation configured by the signed-in account. */
export interface Automation {
  /** Selected reply channels. */
  deliveryMode: DeliveryMode;
  /** Whether a matching comment may trigger a reply. */
  enabled: boolean;
  /** Selected Instagram media identifier. */
  mediaId: string;
  /** Private message when private delivery is enabled. */
  privateReplyText: string | null;
  /** Public reply text when public delivery is enabled. */
  replyText: string;
  /** Configured hashtag matched case-insensitively. */
  triggerText: string;
}

/** Owner-controlled values submitted when saving the automation. */
export interface SaveAutomationInput {
  /** Selected public/private delivery behavior. */
  deliveryMode: DeliveryMode;
  /** Whether new matching comments may run the automation. */
  enabled: boolean;
  /** Selected Instagram post or reel identifier. */
  mediaId: string;
  /** Private message text, or null when private delivery is disabled. */
  privateReplyText: string | null;
  /** Public reply text, or an empty string when public delivery is disabled. */
  replyText: string;
  /** Exact hashtag trigger after trimming. */
  triggerText: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

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
  const deliveryMode = isRecord(value) ? value.deliveryMode : undefined;
  if (
    !isRecord(value) ||
    !isDeliveryMode(deliveryMode) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.mediaId !== 'string' ||
    value.mediaId.trim() === '' ||
    !isNullableString(value.privateReplyText) ||
    typeof value.replyText !== 'string' ||
    typeof value.triggerText !== 'string' ||
    !/^#\S{1,99}$/.test(value.triggerText) ||
    (deliveryMode !== DELIVERY_MODE.PRIVATE && value.replyText.trim() === '') ||
    (deliveryMode !== DELIVERY_MODE.PUBLIC &&
      (value.privateReplyText === null || value.privateReplyText.trim() === '')) ||
    (deliveryMode === DELIVERY_MODE.PUBLIC && value.privateReplyText !== null)
  ) {
    throw new Error('Invalid automation');
  }
  return {
    deliveryMode,
    enabled: value.enabled,
    mediaId: value.mediaId,
    privateReplyText: value.privateReplyText,
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
