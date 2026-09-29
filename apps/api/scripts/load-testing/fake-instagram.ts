import { setTimeout as delay } from 'node:timers/promises';

import {
  InstagramCommentReplyError,
  type InstagramCommentReplyClient,
} from '../../src/instagram/comment-reply-client.js';
import {
  InstagramPrivateReplyError,
  type InstagramPrivateReplyClient,
} from '../../src/instagram/private-reply-client.js';

type Failure = 'permanent' | 'rate-limit' | 'timeout';

const behavior = (commentId: string): Failure | 'slow' | 'success' => {
  if (commentId.includes('-rate-limit-')) return 'rate-limit';
  if (commentId.includes('-permanent-')) return 'permanent';
  if (commentId.includes('-timeout-')) return 'timeout';
  if (commentId.includes('-slow-')) return 'slow';
  return 'success';
};

const diagnostics = (failure: Failure) => {
  if (failure === 'rate-limit') return { reason: 'http_error' as const, httpStatus: 429 };
  if (failure === 'permanent') return { reason: 'http_error' as const, httpStatus: 400 };
  return { reason: 'timeout' as const };
};

/** Creates deterministic provider fakes selected only by synthetic comment-ID prefixes. */
export const createFakeInstagramReplyClients = (
  slowDelayMs: number,
): {
  instagramCommentReplyClient: InstagramCommentReplyClient;
  instagramPrivateReplyClient: InstagramPrivateReplyClient;
} => ({
  instagramCommentReplyClient: {
    async replyToComment({ commentId }) {
      const selected = behavior(commentId);
      if (selected === 'slow') await delay(slowDelayMs);
      if (selected !== 'success' && selected !== 'slow') {
        throw new InstagramCommentReplyError(diagnostics(selected));
      }
      return { replyId: `fake-public-${commentId}` };
    },
  },
  instagramPrivateReplyClient: {
    async sendPrivateReply({ commentId }) {
      const selected = behavior(commentId);
      if (selected === 'slow') await delay(slowDelayMs);
      if (selected !== 'success' && selected !== 'slow') {
        throw new InstagramPrivateReplyError(diagnostics(selected));
      }
      return { recipientId: 'fake-recipient', replyId: `fake-private-${commentId}` };
    },
  },
});
