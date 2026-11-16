import type {
  AccountRepository,
  DmConversationRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import type { InstagramDirectMessageClient } from '../instagram/direct-message-client.js';
import type { IncomingMessageEvent } from '../instagram/webhook-events.js';
import type { Logger } from '../logging/logger.js';
import type { TokenProtector } from '../security/token-protector.js';
import { deliverFollowup } from './deliver-followup.js';

/** Saves one authenticated incoming answer and dispatches its selected one-step follow-up. */
export const processIncomingMessage = async (
  event: IncomingMessageEvent,
  dependencies: {
    accountRepository: Pick<AccountRepository, 'findByInstagramUserId'>;
    dmConversationRepository: DmConversationRepository;
    instagramDirectMessageClient: InstagramDirectMessageClient;
    logger: Logger;
    tokenProtector: TokenProtector;
    tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'>;
  },
): Promise<'ignored' | 'duplicate' | 'recorded' | 'followup_started'> => {
  const account = await dependencies.accountRepository.findByInstagramUserId(
    event.instagramAccountId,
  );
  if (!account || account.connectionStatus !== 'active') return 'ignored';

  const result = await dependencies.dmConversationRepository.recordInboundAnswer({
    accountId: account.id,
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
