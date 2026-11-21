import {
  sendFacebookPageMessage,
  type FacebookMessageConfig,
  type FacebookMessageResult,
} from './message-client.js';

/** Comment-addressed Facebook Page private reply. */
export interface FacebookPrivateReplyInput {
  /** Sending Facebook Page ID. */
  pageId: string;
  /** Decrypted Page token held only for this send. */
  pageAccessToken: string;
  /** Comment that authorizes this private reply. */
  commentId: string;
  /** Owner-configured private text. */
  message: string;
  /** Optional choices displayed with the private reply. */
  quickReplies?: readonly {
    /** Button title. */
    title: string;
    /** Opaque application payload returned by the Messenger webhook. */
    payload: string;
  }[];
}

/** Facebook Page private-reply capability. */
export interface FacebookPrivateReplyClient {
  /** Sends one comment-addressed private message, optionally with quick replies. */
  sendPrivateReply(input: FacebookPrivateReplyInput): Promise<FacebookMessageResult>;
}

/** Creates a Page private-reply adapter using the current Page Messages edge. */
export const createFacebookPrivateReplyClient = (
  config: FacebookMessageConfig,
  fetcher: typeof fetch = fetch,
): FacebookPrivateReplyClient => ({
  sendPrivateReply(input) {
    return sendFacebookPageMessage(
      'private_reply',
      {
        pageId: input.pageId,
        pageAccessToken: input.pageAccessToken,
        body: {
          recipient: { comment_id: input.commentId },
          message: {
            text: input.message,
            ...(input.quickReplies?.length
              ? {
                  quick_replies: input.quickReplies.map((choice) => ({
                    content_type: 'text',
                    title: choice.title,
                    payload: choice.payload,
                  })),
                }
              : {}),
          },
        },
      },
      config,
      fetcher,
    );
  },
});
