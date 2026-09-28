import { describe, expect, it, vi } from 'vitest';

import {
  createInstagramPrivateReplyClient,
  InstagramPrivateReplyError,
} from './private-reply-client.js';

const input = {
  accessToken: 'private-access-token',
  commentId: '17841400000000001',
  instagramUserId: '17841400000000002',
  message: 'Here is your private reply.',
};

describe('Instagram private-reply HTTP adapter', () => {
  it('posts a comment-addressed message without credentials in the URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message_id: 'message-id', recipient_id: 'recipient-id' })),
      );

    await expect(
      createInstagramPrivateReplyClient({ apiVersion: 'v24.0' }, fetcher).sendPrivateReply(input),
    ).resolves.toEqual({ recipientId: 'recipient-id', replyId: 'message-id' });

    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://graph.instagram.com/v24.0/17841400000000002/messages');
    expect(String(url)).not.toContain(input.accessToken);
    expect(request?.headers).toEqual({
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      message: { text: input.message },
      recipient: { comment_id: input.commentId },
    });
  });

  it('reports only safe Meta diagnostics and classifies authentication rejection', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 190, error_subcode: 463, message: 'provider secret' } }),
          { status: 400 },
        ),
      );

    try {
      await createInstagramPrivateReplyClient({ apiVersion: 'v24.0' }, fetcher).sendPrivateReply(
        input,
      );
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InstagramPrivateReplyError);
      const providerError = error as InstagramPrivateReplyError;
      expect(providerError.recoveryKind()).toBe('authentication');
      expect(providerError.toLogContext()).toEqual({
        errorName: 'InstagramPrivateReplyError',
        httpStatus: '400',
        metaErrorCode: '190',
        metaErrorSubcode: '463',
        reason: 'http_error',
      });
      expect(JSON.stringify(providerError.toLogContext())).not.toContain('provider secret');
    }
  });

  it('treats timeouts and malformed success payloads as uncertain', async () => {
    const timeoutClient = createInstagramPrivateReplyClient(
      { apiVersion: 'v24.0' },
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('private detail', 'TimeoutError')),
    );
    await expect(timeoutClient.sendPrivateReply(input)).rejects.toMatchObject({
      name: 'InstagramPrivateReplyError',
    });

    const malformedClient = createInstagramPrivateReplyClient(
      { apiVersion: 'v24.0' },
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }))),
    );
    await expect(malformedClient.sendPrivateReply(input)).rejects.toMatchObject({
      name: 'InstagramPrivateReplyError',
    });
  });
});
