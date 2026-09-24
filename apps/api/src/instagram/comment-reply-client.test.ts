import { describe, expect, it, vi } from 'vitest';

import {
  createInstagramCommentReplyClient,
  InstagramCommentReplyError,
} from './comment-reply-client.js';

const config = { apiVersion: 'v24.0' };
const input = {
  accessToken: 'private-access-token',
  commentId: '17841400000000001',
  message: 'Thanks for commenting!',
};

const failureContext = async (operation: Promise<unknown>) => {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(InstagramCommentReplyError);
    return (error as InstagramCommentReplyError).toLogContext();
  }
  throw new Error('Expected Instagram comment reply to fail');
};

describe('Instagram comment-reply HTTP adapter', () => {
  it('posts a form-encoded public reply without placing credentials or reply text in the URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: '17841400000000002' }), { status: 200 }),
      );

    await expect(
      createInstagramCommentReplyClient(config, fetcher).replyToComment(input),
    ).resolves.toBeUndefined();

    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://graph.instagram.com/v24.0/17841400000000001/replies');
    expect(String(url)).not.toContain(input.accessToken);
    expect(String(url)).not.toContain('Thanks');
    expect(request?.headers).toEqual({
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    });
    expect(String(request?.body)).toBe('message=Thanks+for+commenting%21');
    expect(request?.redirect).toBe('error');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves numeric reply IDs beyond JavaScript safe integers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"id":17841400000000002}', { status: 200 }));

    await expect(
      createInstagramCommentReplyClient(config, fetcher).replyToComment(input),
    ).resolves.toBeUndefined();
  });

  it('reports safe Meta diagnostics without response content', async () => {
    const secret = 'private provider detail';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 190, error_subcode: 463, message: secret },
          access_token: secret,
        }),
        { status: 400 },
      ),
    );
    const operation = createInstagramCommentReplyClient(config, fetcher).replyToComment(input);

    await expect(operation).rejects.toThrow('Instagram comment reply failed');
    expect(await failureContext(operation)).toEqual({
      errorName: 'InstagramCommentReplyError',
      reason: 'http_error',
      httpStatus: '400',
      metaErrorCode: '190',
      metaErrorSubcode: '463',
    });
  });

  it('classifies malformed responses and timeouts without retrying', async () => {
    const malformedFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    const malformed = createInstagramCommentReplyClient(config, malformedFetcher).replyToComment(
      input,
    );
    await expect(malformed).rejects.toThrow('Instagram comment reply failed');
    expect(await failureContext(malformed)).toEqual({
      errorName: 'InstagramCommentReplyError',
      reason: 'invalid_response',
      httpStatus: '200',
    });

    const timeout = new DOMException('private timeout detail', 'TimeoutError');
    const timeoutFetcher = vi.fn<typeof fetch>().mockRejectedValue(timeout);
    const timedOut = createInstagramCommentReplyClient(config, timeoutFetcher).replyToComment(
      input,
    );
    await expect(timedOut).rejects.toThrow('Instagram comment reply failed');
    expect(await failureContext(timedOut)).toEqual({
      errorName: 'InstagramCommentReplyError',
      reason: 'timeout',
    });
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });
});
