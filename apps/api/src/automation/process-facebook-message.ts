import type { DmConversationRepository } from '../database/repositories.js';
import type { SocialConnectionRepository } from '../database/identity-repositories.js';
import type { FacebookIncomingMessageEvent } from '../facebook/webhook-events.js';
import { deliverFollowup, type FollowupDeliveryDependencies } from './deliver-followup.js';

/** Saves one signed Page message and starts the selected follow-up at most once. */
export const processFacebookMessage = async (
  event: FacebookIncomingMessageEvent,
  dependencies: FollowupDeliveryDependencies & {
    socialConnectionRepository: Pick<SocialConnectionRepository, 'findFacebookPageByPageId'>;
    dmConversationRepository: DmConversationRepository;
  },
): Promise<'ignored' | 'duplicate' | 'recorded' | 'followup_started'> => {
  const page = await dependencies.socialConnectionRepository.findFacebookPageByPageId(event.pageId);
  if (!page || page.connectionStatus !== 'active') return 'ignored';

  const result = await dependencies.dmConversationRepository.recordInboundAnswer({
    accountId: page.id,
    providerMessageId: event.messageId,
    senderIgsid: event.senderId,
    text: event.text,
    quickReplyPayload: event.quickReplyPayload,
    sentAt: event.timestamp,
    receivedAt: new Date(),
  });
  if (!result) return 'ignored';
  if (result.duplicate) return 'duplicate';
  if (!result.followup) return 'recorded';

  const now = new Date();
  const claim = await dependencies.dmConversationRepository.claimFollowup(
    result.followup.id,
    now,
    new Date(now.getTime() + 2 * 60 * 1000),
  );
  if (!claim) return 'recorded';
  await deliverFollowup(claim, dependencies, now);
  return 'followup_started';
};
