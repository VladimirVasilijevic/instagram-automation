import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IncomingMessageEvent } from '../instagram/webhook-events.js';
import { deliverFollowup } from './deliver-followup.js';
import { processIncomingMessage } from './process-incoming-message.js';

vi.mock('./deliver-followup.js', () => ({ deliverFollowup: vi.fn() }));

const event: IncomingMessageEvent = {
  instagramAccountId: 'owner-ig-id',
  messageId: 'mid-1',
  quickReplyPayload: 'qr:execution-id:option-id',
  recipientId: 'owner-ig-id',
  senderId: 'sender-igsid',
  text: 'Yes',
  timestamp: new Date('2026-11-16T12:00:00.000Z'),
};

const createFixture = () => {
  const accountRepository = {
    findByInstagramUserId: vi
      .fn()
      .mockResolvedValue({ id: 'account-id', connectionStatus: 'active' }),
  };
  const dmConversationRepository = {
    recordInboundAnswer: vi.fn().mockResolvedValue(null),
    claimFollowup: vi.fn().mockResolvedValue(null),
  };
  const dependencies = {
    accountRepository,
    dmConversationRepository,
    instagramDirectMessageClient: { sendDirectMessage: vi.fn() },
    logger: { error: vi.fn(), info: vi.fn() },
    tokenProtector: { decrypt: vi.fn() },
    tokenRefreshRepository: { markAccountReconnectRequired: vi.fn() },
  } as unknown as Parameters<typeof processIncomingMessage>[1];
  return { accountRepository, dmConversationRepository, dependencies };
};

beforeEach(() => vi.resetAllMocks());

describe('incoming quick-reply processing', () => {
  it('ignores messages for accounts that are not connected', async () => {
    const f = createFixture();
    f.accountRepository.findByInstagramUserId.mockResolvedValue(null);
    expect(await processIncomingMessage(event, f.dependencies)).toBe('ignored');
    expect(f.dmConversationRepository.recordInboundAnswer).not.toHaveBeenCalled();
  });

  it('records an answer once and does not dispatch a duplicate webhook', async () => {
    const f = createFixture();
    f.dmConversationRepository.recordInboundAnswer.mockResolvedValue({
      answer: { id: 'answer-id' },
      followup: { id: 'followup-id' },
      duplicate: true,
    });
    expect(await processIncomingMessage(event, f.dependencies)).toBe('duplicate');
    expect(f.dmConversationRepository.claimFollowup).not.toHaveBeenCalled();
    expect(deliverFollowup).not.toHaveBeenCalled();
  });

  it('claims and sends one follow-up for a new selected answer', async () => {
    const f = createFixture();
    const claim = { followup: { id: 'followup-id' } };
    f.dmConversationRepository.recordInboundAnswer.mockResolvedValue({
      answer: { id: 'answer-id' },
      followup: { id: 'followup-id' },
      duplicate: false,
    });
    f.dmConversationRepository.claimFollowup.mockResolvedValue(claim);
    vi.mocked(deliverFollowup).mockResolvedValue('succeeded');

    expect(await processIncomingMessage(event, f.dependencies)).toBe('followup_started');
    expect(f.dmConversationRepository.recordInboundAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-id',
        providerMessageId: 'mid-1',
        senderIgsid: 'sender-igsid',
        quickReplyPayload: 'qr:execution-id:option-id',
      }),
    );
    expect(f.dmConversationRepository.claimFollowup).toHaveBeenCalledWith(
      'followup-id',
      expect.any(Date),
      expect.any(Date),
    );
    expect(deliverFollowup).toHaveBeenCalledWith(claim, f.dependencies, expect.any(Date));
  });
});
