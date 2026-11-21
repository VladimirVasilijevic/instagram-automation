import { z } from 'zod';

import { expectFacebookResponse, requestFacebookJson } from './http.js';

/** Confirmed Messenger send result. */
export interface FacebookMessageResult {
  /** Page-scoped recipient identifier returned by Meta. */
  recipientId: string;
  /** Opaque Meta message identifier. */
  replyId: string;
}

/** Versioned Graph settings for Page messages. */
export interface FacebookMessageConfig {
  /** Explicit Graph API version. */
  apiVersion: string;
}

const responseSchema = z.object({
  recipient_id: z.string().trim().min(1),
  message_id: z.string().trim().min(1),
});

/** Sends one Page message through the current Messenger endpoint. */
export const sendFacebookPageMessage = async (
  operation: 'private_reply' | 'followup_message',
  input: {
    /** Sending Page ID. */
    pageId: string;
    /** Decrypted Page token. */
    pageAccessToken: string;
    /** Messenger request body. */
    body: Record<string, unknown>;
  },
  config: FacebookMessageConfig,
  fetcher: typeof fetch = fetch,
): Promise<FacebookMessageResult> => {
  const url = new URL(
    `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(input.pageId)}/messages`,
  );
  const result = expectFacebookResponse(
    operation,
    (value) => responseSchema.safeParse(value),
    await requestFacebookJson(
      operation,
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.pageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.body),
      },
      fetcher,
    ),
  );
  return { recipientId: result.recipient_id, replyId: result.message_id };
};
