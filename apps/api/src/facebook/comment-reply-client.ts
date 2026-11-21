import { z } from 'zod';

import { expectFacebookResponse, requestFacebookJson } from './http.js';

/** Public Facebook Page reply request. */
export interface FacebookCommentReplyInput {
  /** Decrypted Page token, held only for this request. */
  pageAccessToken: string;
  /** Page comment receiving the public reply. */
  commentId: string;
  /** Owner-configured reply text. */
  message: string;
}

/** Provider-confirmed public reply. */
export interface FacebookCommentReplyResult {
  /** New Facebook comment ID. */
  replyId: string;
}

/** Public comment-reply capability for a Facebook Page. */
export interface FacebookCommentReplyClient {
  /** Publishes one Page comment beneath a matching comment. */
  replyToComment(input: FacebookCommentReplyInput): Promise<FacebookCommentReplyResult>;
}

/** Versioned API settings for public Page replies. */
export interface FacebookCommentReplyConfig {
  /** Explicit Graph API version. */
  apiVersion: string;
}

const replySchema = z.object({ id: z.string().trim().min(1) });

/** Creates a Page public-reply adapter. */
export const createFacebookCommentReplyClient = (
  config: FacebookCommentReplyConfig,
  fetcher: typeof fetch = fetch,
): FacebookCommentReplyClient => ({
  async replyToComment({ pageAccessToken, commentId, message }) {
    const url = new URL(
      `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(commentId)}/comments`,
    );
    const reply = expectFacebookResponse(
      'public_reply',
      (value) => replySchema.safeParse(value),
      await requestFacebookJson(
        'public_reply',
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pageAccessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: new URLSearchParams({ message }),
        },
        fetcher,
      ),
    );
    return { replyId: reply.id };
  },
});
