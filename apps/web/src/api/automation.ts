import {
  DELIVERY_MODE,
  TRIGGER_MODE,
  isDeliveryMode,
  isTriggerMode,
  type DeliveryMode,
  type TriggerMode,
} from '@instagram-automation/contracts';

export type { DeliveryMode, TriggerMode } from '@instagram-automation/contracts';

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
  /** Comment-matching rule. */
  triggerMode: TriggerMode;
  /** Configured text for exact and contains rules, or null for every comment. */
  triggerText: string | null;
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
  /** Comment-matching rule. */
  triggerMode: TriggerMode;
  /** Configured text for exact and contains rules, or null for every comment. */
  triggerText: string | null;
}

/** Safe save-failure categories the browser may render with specific recovery guidance. */
export type AutomationSaveErrorCode =
  'INSTAGRAM_COMMENT_SUBSCRIPTION_UNAVAILABLE' | 'INSTAGRAM_RECONNECT_REQUIRED';

/** Safe application-owned failure returned while saving automation settings. */
export class AutomationSaveError extends Error {
  /** Stable application-owned category; never contains provider response details. */
  readonly code: AutomationSaveErrorCode;

  constructor(code: AutomationSaveErrorCode) {
    super('Automation settings could not be saved. Please try again.');
    this.name = 'AutomationSaveError';
    this.code = code;
  }
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
  const triggerMode = isRecord(value) ? value.triggerMode : undefined;
  if (
    !isRecord(value) ||
    !isDeliveryMode(deliveryMode) ||
    !isTriggerMode(triggerMode) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.mediaId !== 'string' ||
    value.mediaId.trim() === '' ||
    !isNullableString(value.privateReplyText) ||
    typeof value.replyText !== 'string' ||
    !isNullableString(value.triggerText) ||
    (triggerMode === TRIGGER_MODE.ALL && value.triggerText !== null) ||
    (triggerMode !== TRIGGER_MODE.ALL &&
      (value.triggerText === null ||
        value.triggerText !== value.triggerText.trim() ||
        value.triggerText.length < 1 ||
        value.triggerText.length > 100)) ||
    (triggerMode === TRIGGER_MODE.CONTAINS &&
      (value.triggerText === null || !/^#?[\p{L}\p{N}_]+$/u.test(value.triggerText))) ||
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
    triggerMode,
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
  if (!response.ok) {
    try {
      const payload = await response.json();
      const code = isRecord(payload) && isRecord(payload.error) ? payload.error.code : undefined;
      if (
        code === 'INSTAGRAM_COMMENT_SUBSCRIPTION_UNAVAILABLE' ||
        code === 'INSTAGRAM_RECONNECT_REQUIRED'
      ) {
        throw new AutomationSaveError(code);
      }
    } catch (error) {
      if (error instanceof AutomationSaveError) throw error;
    }
    throw new Error('Automation settings could not be saved. Please try again.');
  }
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
