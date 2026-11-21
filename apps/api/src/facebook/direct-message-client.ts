import {
  sendFacebookPageMessage,
  type FacebookMessageConfig,
  type FacebookMessageResult,
} from './message-client.js';

/** Reply to a Messenger user who selected a quick-reply choice. */
export interface FacebookDirectMessageInput {
  /** Sending Facebook Page ID. */
  pageId: string;
  /** Decrypted Page token held only for this send. */
  pageAccessToken: string;
  /** Page-scoped recipient identifier from a confirmed private reply or inbound webhook. */
  recipientId: string;
  /** Owner-configured follow-up text. */
  message: string;
}

/** Facebook Messenger follow-up capability. */
export interface FacebookDirectMessageClient {
  /** Sends a response to a recipient inside the Messenger response window. */
  sendDirectMessage(input: FacebookDirectMessageInput): Promise<FacebookMessageResult>;
}

/** Creates a Page Messenger follow-up adapter. */
export const createFacebookDirectMessageClient = (
  config: FacebookMessageConfig,
  fetcher: typeof fetch = fetch,
): FacebookDirectMessageClient => ({
  sendDirectMessage(input) {
    return sendFacebookPageMessage(
      'followup_message',
      {
        pageId: input.pageId,
        pageAccessToken: input.pageAccessToken,
        body: {
          messaging_type: 'RESPONSE',
          recipient: { id: input.recipientId },
          message: { text: input.message },
        },
      },
      config,
      fetcher,
    );
  },
});
