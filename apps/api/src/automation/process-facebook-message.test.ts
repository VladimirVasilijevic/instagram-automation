import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FacebookIncomingMessageEvent } from '../facebook/webhook-events.js';
import { deliverFollowup } from './deliver-followup.js';
import { processFacebookMessage } from './process-facebook-message.js';

vi.mock('./deliver-followup.js', () => ({ deliverFollowup: vi.fn() }));

const event: FacebookIncomingMessageEvent = {
  pageId: 'page-id',
  messageId: 'message-id',
  senderId: 'page-scoped-sender',
  recipientId: 'page-id',
  quickReplyPayload: 'qr:execution-id:choice-id',
  text: 'Yes',
  timestamp: new Date('2026-11-21T10:00:00.000Z'),
};

const fixture = () => {
  const socialConnectionRepository = {
    findFacebookPageByPageId: vi.fn().mockResolvedValue({
      id: 'connection-id',
      connectionStatus: 'active',
    }),
  };
  const dmConversationRepository = {
    recordInboundAnswer: vi.fn().mockResolvedValue(null),
    claimFollowup: vi.fn().mockResolvedValue(null),
  };
  const dependencies = {
    socialConnectionRepository,
    dmConversationRepository,
  } as unknown as Parameters<typeof processFacebookMessage>[1];
  return { socialConnectionRepository, dmConversationRepository, dependencies };
};

beforeEach(() => vi.resetAllMocks());

describe('Facebook incoming message processing', () => {
  it('ignores unknown or disconnected Pages', async () => {
    const f = fixture();
    f.socialConnectionRepository.findFacebookPageByPageId.mockResolvedValue(null);
    expect(await processFacebookMessage(event, f.dependencies)).toBe('ignored');
    f.socialConnectionRepository.findFacebookPageByPageId.mockResolvedValue({
      id: 'connection-id',
      connectionStatus: 'reconnect_required',
    });
    expect(await processFacebookMessage(event, f.dependencies)).toBe('ignored');
    expect(f.dmConversationRepository.recordInboundAnswer).not.toHaveBeenCalled();
  });

  it('does not dispatch an already recorded message', async () => {
    const f = fixture();
    f.dmConversationRepository.recordInboundAnswer.mockResolvedValue({
      answer: { id: 'answer-id' },
      followup: { id: 'followup-id' },
      duplicate: true,
    });
    expect(await processFacebookMessage(event, f.dependencies)).toBe('duplicate');
    expect(deliverFollowup).not.toHaveBeenCalled();
  });

  it('records the Page connection and delivers one selected follow-up', async () => {
    const f = fixture();
    const claim = { followup: { id: 'followup-id' } };
    f.dmConversationRepository.recordInboundAnswer.mockResolvedValue({
      answer: { id: 'answer-id' },
      followup: { id: 'followup-id' },
      duplicate: false,
    });
    f.dmConversationRepository.claimFollowup.mockResolvedValue(claim);
    vi.mocked(deliverFollowup).mockResolvedValue('succeeded');
    expect(await processFacebookMessage(event, f.dependencies)).toBe('followup_started');
    expect(f.dmConversationRepository.recordInboundAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'connection-id',
        providerMessageId: 'message-id',
        senderIgsid: 'page-scoped-sender',
        quickReplyPayload: event.quickReplyPayload,
      }),
    );
    expect(deliverFollowup).toHaveBeenCalledWith(claim, f.dependencies, expect.any(Date));
  });
});
