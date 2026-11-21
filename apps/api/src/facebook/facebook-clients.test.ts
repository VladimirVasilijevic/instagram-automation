import { describe, expect, it, vi } from 'vitest';

import { createFacebookCommentReplyClient } from './comment-reply-client.js';
import { createFacebookDirectMessageClient } from './direct-message-client.js';
import { FacebookClientError } from './http.js';
import { createFacebookLoginClient } from './login-client.js';
import {
  createFacebookPageClient,
  hasFacebookCommentTask,
  hasFacebookMessagingTask,
} from './page-client.js';
import { createFacebookPrivateReplyClient } from './private-reply-client.js';

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('Facebook Login adapter', () => {
  const config = {
    appId: '12345',
    appSecret: 'test-secret',
    apiVersion: 'v24.0',
    redirectUri: 'https://example.test/api/auth/facebook/callback',
  };

  it('uses different scopes for sign-in and Page connection', () => {
    const client = createFacebookLoginClient(config, vi.fn());
    const signIn = new URL(client.authorizationUrl('random-state', 'sign_in'));
    const connect = new URL(client.authorizationUrl('random-state', 'connect_page'));
    expect(signIn.origin).toBe('https://www.facebook.com');
    expect(signIn.searchParams.get('scope')).toBe('public_profile');
    expect(connect.searchParams.get('scope')).toContain('pages_messaging');
    expect(connect.searchParams.get('scope')).toContain('pages_manage_engagement');
    expect(connect.searchParams.get('state')).toBe('random-state');
    expect(connect.searchParams.get('response_type')).toBe('code');
  });

  it('exchanges a code and fetches the app-scoped person ID', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ access_token: 'user-token', expires_in: 3600 }))
      .mockResolvedValueOnce(response({ id: '123456', name: 'Example User' }));
    const client = createFacebookLoginClient(config, fetcher, () => 1_000);
    expect(await client.completeLogin('one-time-code')).toEqual({
      facebookUserId: '123456',
      displayName: 'Example User',
      accessToken: 'user-token',
      tokenExpiresAt: new Date(3_601_000),
    });
    const tokenUrl = fetcher.mock.calls[0]?.[0] as URL;
    expect(tokenUrl.searchParams.get('code')).toBe('one-time-code');
    expect(tokenUrl.searchParams.get('client_secret')).toBe('test-secret');
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({ Authorization: 'Bearer user-token' });
  });

  it.each(['sign_in', 'connect_page'] as const)(
    'uses Business Login configuration for %s without overriding its permissions',
    (intent) => {
      const fetcher = vi.fn();
      const client = createFacebookLoginClient(
        { ...config, configId: '3019408061751454' },
        fetcher,
      );
      const url = new URL(client.authorizationUrl('browser-bound-state', intent));
      expect(url.searchParams.get('config_id')).toBe('3019408061751454');
      expect(url.searchParams.has('scope')).toBe(false);
      expect(url.searchParams.get('client_id')).toBe(config.appId);
      expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('browser-bound-state');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe('Facebook Page adapter', () => {
  it('requires explicit Page tasks for comment and Messenger capabilities', () => {
    expect(hasFacebookCommentTask({ tasks: ['MODERATE'] })).toBe(true);
    expect(hasFacebookCommentTask({ tasks: ['CREATE_CONTENT', 'MESSAGING'] })).toBe(false);
    expect(hasFacebookCommentTask({ tasks: [] })).toBe(false);
    expect(hasFacebookMessagingTask({ tasks: ['MESSAGING'] })).toBe(true);
    expect(hasFacebookMessagingTask({ tasks: ['MODERATE'] })).toBe(false);
  });

  it('discovers Page tokens across cursor pages and subscribes to feed and messages', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: [{ id: '11', name: 'First', access_token: 'page-token-1', tasks: ['MODERATE'] }],
          paging: { cursors: { after: 'next-cursor' } },
        }),
      )
      .mockResolvedValueOnce(
        response({ data: [{ id: '22', name: 'Second', access_token: 'page-token-2' }] }),
      )
      .mockResolvedValueOnce(response({ success: true }));
    const client = createFacebookPageClient({ apiVersion: 'v24.0' }, fetcher);
    expect(await client.listManagedPages('user-token')).toEqual([
      { id: '11', name: 'First', accessToken: 'page-token-1', tasks: ['MODERATE'] },
      { id: '22', name: 'Second', accessToken: 'page-token-2', tasks: [] },
    ]);
    expect((fetcher.mock.calls[1]?.[0] as URL).searchParams.get('after')).toBe('next-cursor');
    await client.subscribeToEvents({
      pageId: '22',
      pageAccessToken: 'page-token-2',
      includeMessages: true,
    });
    const [, init] = fetcher.mock.calls[2]!;
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer page-token-2' });
    expect((init?.body as URLSearchParams).get('subscribed_fields')).toBe('feed,messages');
  });

  it('lists recent Page posts without exposing the Page token in the URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          { id: 'page-1_42', message: 'New post', permalink_url: 'https://facebook.com/post/42' },
        ],
      }),
    );
    const client = createFacebookPageClient({ apiVersion: 'v24.0' }, fetcher);
    expect(
      await client.listRecentPosts({ pageId: 'page-1', pageAccessToken: 'page-secret', limit: 12 }),
    ).toEqual([
      { id: 'page-1_42', message: 'New post', permalinkUrl: 'https://facebook.com/post/42' },
    ]);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('/page-1/feed');
    expect(String(url)).not.toContain('page-secret');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer page-secret' });
  });
});

describe('Facebook Page reply adapters', () => {
  it('posts a public reply beneath the comment with the Page token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ id: 'reply-1' }));
    const client = createFacebookCommentReplyClient({ apiVersion: 'v24.0' }, fetcher);
    expect(
      await client.replyToComment({
        pageAccessToken: 'page-secret',
        commentId: 'comment-1',
        message: 'Thanks!',
      }),
    ).toEqual({ replyId: 'reply-1' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('/comment-1/comments');
    expect((init?.body as URLSearchParams).get('message')).toBe('Thanks!');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer page-secret' });
  });

  it('addresses a private reply by comment and includes quick-reply choices', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ recipient_id: 'psid-1', message_id: 'message-1' }));
    const client = createFacebookPrivateReplyClient({ apiVersion: 'v24.0' }, fetcher);
    expect(
      await client.sendPrivateReply({
        pageId: 'page-1',
        pageAccessToken: 'page-secret',
        commentId: 'comment-1',
        message: 'How can we help?',
        quickReplies: [{ title: 'Pricing', payload: 'choice-1' }],
      }),
    ).toEqual({ recipientId: 'psid-1', replyId: 'message-1' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('/page-1/messages');
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { comment_id: 'comment-1' },
      message: {
        text: 'How can we help?',
        quick_replies: [{ content_type: 'text', title: 'Pricing', payload: 'choice-1' }],
      },
    });
  });

  it('sends a follow-up to the Page-scoped recipient ID', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ recipient_id: 'psid-1', message_id: 'followup-1' }));
    const client = createFacebookDirectMessageClient({ apiVersion: 'v24.0' }, fetcher);
    expect(
      await client.sendDirectMessage({
        pageId: 'page-1',
        pageAccessToken: 'page-secret',
        recipientId: 'psid-1',
        message: 'Our prices start at $10.',
      }),
    ).toEqual({ recipientId: 'psid-1', replyId: 'followup-1' });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      messaging_type: 'RESPONSE',
      recipient: { id: 'psid-1' },
      message: { text: 'Our prices start at $10.' },
    });
  });

  it('classifies explicit rejection without exposing provider body', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ error: { code: 190, message: 'token was private-secret' } }, 401),
      );
    const client = createFacebookCommentReplyClient({ apiVersion: 'v24.0' }, fetcher);
    let thrown: unknown;
    try {
      await client.replyToComment({
        pageAccessToken: 'private-secret',
        commentId: 'comment-1',
        message: 'Hello',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FacebookClientError);
    if (!(thrown instanceof FacebookClientError)) return;
    expect(thrown).toMatchObject({
      reason: 'http_error',
      httpStatus: 401,
      metaErrorCode: 190,
    });
    expect(thrown.recoveryKind()).toBe('authentication');
    expect(JSON.stringify(thrown.toLogContext())).not.toContain('private-secret');
  });

  it('treats a transport failure after an attempted send as uncertain', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network unavailable'));
    const client = createFacebookPrivateReplyClient({ apiVersion: 'v24.0' }, fetcher);
    let thrown: unknown;
    try {
      await client.sendPrivateReply({
        pageId: 'page-1',
        pageAccessToken: 'page-secret',
        commentId: 'comment-1',
        message: 'Hello',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FacebookClientError);
    if (!(thrown instanceof FacebookClientError)) return;
    expect(thrown).toMatchObject({ reason: 'network_error', operation: 'private_reply' });
    expect(thrown.recoveryKind()).toBe('uncertain');
  });

  it('classifies HTTP throttling as retryable and server rejection as uncertain', () => {
    expect(new FacebookClientError('send', 'http_error', { httpStatus: 429 }).recoveryKind()).toBe(
      'retryable',
    );
    for (const metaErrorCode of [613, 80001]) {
      expect(
        new FacebookClientError('send', 'http_error', {
          httpStatus: 400,
          metaErrorCode,
        }).recoveryKind(),
      ).toBe('retryable');
    }
    expect(new FacebookClientError('send', 'http_error', { httpStatus: 500 }).recoveryKind()).toBe(
      'uncertain',
    );
  });
});
