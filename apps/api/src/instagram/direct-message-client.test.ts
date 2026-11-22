import { describe, expect, it, vi } from 'vitest';

import {
  createInstagramDirectMessageClient,
  InstagramDirectMessageError,
} from './direct-message-client.js';

const input = {
  accessToken: 'private-access-token',
  instagramUserId: '17841400000000002',
  recipientId: '17841400000000004',
  message: 'Here is your follow-up.',
};

describe('Instagram recipient-addressed direct-message adapter', () => {
  it('posts a message to the recipient ID without credentials in the URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message_id: 'message-id', recipient_id: input.recipientId })),
      );

    await expect(
      createInstagramDirectMessageClient({ apiVersion: 'v24.0' }, fetcher).sendDirectMessage(input),
    ).resolves.toEqual({ recipientId: input.recipientId, replyId: 'message-id' });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://graph.instagram.com/v24.0/17841400000000002/messages');
    expect(String(url)).not.toContain(input.accessToken);
    expect(request?.headers).toEqual({
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      message: { text: input.message },
      recipient: { id: input.recipientId },
    });
  });

  it('serializes Story answer choices as recipient-addressed quick replies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message_id: 'message-id', recipient_id: input.recipientId })),
      );
    await createInstagramDirectMessageClient({ apiVersion: 'v24.0' }, fetcher).sendDirectMessage({
      ...input,
      quickReplies: [{ title: 'Yes', payload: 'qr:execution-id:yes' }],
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({
      recipient: { id: input.recipientId },
      message: {
        text: input.message,
        quick_replies: [{ content_type: 'text', title: 'Yes', payload: 'qr:execution-id:yes' }],
      },
    });
  });

  it('classifies errors without logging provider content', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 190, message: 'provider secret' } }), {
        status: 400,
      }),
    );
    try {
      await createInstagramDirectMessageClient({ apiVersion: 'v24.0' }, fetcher).sendDirectMessage(
        input,
      );
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InstagramDirectMessageError);
      const providerError = error as InstagramDirectMessageError;
      expect(providerError.recoveryKind()).toBe('authentication');
      expect(providerError.toLogContext()).toEqual({
        errorName: 'InstagramDirectMessageError',
        httpStatus: '400',
        metaErrorCode: '190',
        reason: 'http_error',
      });
      expect(JSON.stringify(providerError.toLogContext())).not.toContain('provider secret');
    }
  });

  it('treats transport failures as uncertain', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private transport detail'));
    await expect(
      createInstagramDirectMessageClient({ apiVersion: 'v24.0' }, fetcher).sendDirectMessage(input),
    ).rejects.toMatchObject({ name: 'InstagramDirectMessageError' });
  });
});
