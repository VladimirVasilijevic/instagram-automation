import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';

import type {
  DmConversationRepository,
  InstagramAccount,
  Session,
} from '../database/repositories.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';
import { registerDmAnswerRoutes } from './dm-answers.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 6).toString('base64'));
const account: InstagramAccount = {
  accessTokenCiphertext: tokenProtector.encrypt('test-token'),
  connectionStatus: 'active',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  id: 'account-id',
  instagramUserId: '17841400000000001',
  tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  tokenRefreshFailureCode: null,
  tokenRefreshLastSucceededAt: null,
  tokenRefreshNextAttemptAt: null,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  username: 'owner',
};

describe('DM answer activity route', () => {
  it('returns only safe account-owned answer fields after session authentication', async () => {
    const token = createSessionToken();
    const session: Session = {
      accountId: account.id,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      id: 'session-id',
    };
    const listRecentAnswersByAccountId = vi
      .fn<DmConversationRepository['listRecentAnswersByAccountId']>()
      .mockResolvedValue([
        {
          answer: {
            id: 'answer-id',
            accountId: account.id,
            executionId: 'execution-id',
            providerMessageId: 'provider-mid',
            senderIgsid: 'private-igsid',
            optionId: 'option-id',
            text: 'Yes',
            sentAt: new Date('2026-09-24T12:00:00.000Z'),
            receivedAt: new Date('2026-09-24T12:00:01.000Z'),
          },
          choiceTitle: 'Yes',
          commenterUsername: 'customer',
          mediaId: 'media-id',
          followup: {
            id: 'followup-id',
            accountId: account.id,
            answerId: 'answer-id',
            recipientIgsid: 'private-igsid',
            messageText: 'Private follow-up',
            expiresAt: new Date('2026-09-25T12:00:00.000Z'),
            status: 'succeeded',
            attemptCount: 1,
            nextAttemptAt: null,
            leaseId: null,
            leaseExpiresAt: null,
            dispatchStartedAt: new Date('2026-09-24T12:00:01.000Z'),
            providerReplyId: 'reply-id',
            failureKind: null,
            errorCode: null,
            errorMessage: null,
            createdAt: new Date('2026-09-24T12:00:01.000Z'),
            updatedAt: new Date('2026-09-24T12:00:01.000Z'),
          },
        },
      ]);
    const app = new OpenAPIHono();
    registerDmAnswerRoutes(app, {
      dmConversationRepository: { listRecentAnswersByAccountId },
      logger: { error: vi.fn(), info: vi.fn() },
      sessionCookie: { name: 'igauto_session', secure: false, ttlSeconds: 3600 },
      sessionRepository: {
        findActiveByTokenHash: vi.fn().mockResolvedValue({ account, session }),
      },
    });

    expect((await app.request('/api/dm-answers')).status).toBe(401);
    const response = await app.request('/api/dm-answers', {
      headers: { Cookie: `igauto_session=${token.token}` },
    });
    expect(response.status).toBe(200);
    expect(listRecentAnswersByAccountId).toHaveBeenCalledWith(account.id, 50, undefined);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      answers: [
        {
          choiceTitle: 'Yes',
          commenterUsername: 'customer',
          followupStatus: 'succeeded',
          mediaId: 'media-id',
          receivedAt: '2026-09-24T12:00:01.000Z',
          typedText: null,
        },
      ],
    });
    expect(body).not.toContain('private-igsid');
    expect(body).not.toContain('Private follow-up');

    const filtered = await app.request('/api/dm-answers?mediaId=selected-post', {
      headers: { Cookie: `igauto_session=${token.token}` },
    });
    expect(filtered.status).toBe(200);
    expect(listRecentAnswersByAccountId).toHaveBeenLastCalledWith(account.id, 50, 'selected-post');
    const invalid = await app.request('/api/dm-answers?mediaId=', {
      headers: { Cookie: `igauto_session=${token.token}` },
    });
    expect(invalid.status).toBe(400);
  });
});
