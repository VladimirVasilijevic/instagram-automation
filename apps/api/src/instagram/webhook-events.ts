import { z } from 'zod';

/** One validated Instagram comment delivery, kept separate from Meta's raw webhook envelope. */
export interface CommentEvent {
  /** Instagram professional account receiving the comment. */
  instagramAccountId: string;
  /** Opaque Instagram comment identifier. */
  commentId: string;
  /** Instagram-scoped commenter identifier when Meta includes one. */
  commenterId: string | null;
  /** Opaque Instagram media identifier on which the comment was made. */
  mediaId: string;
  /** Parent comment identifier for nested replies; null for top-level comments. */
  parentCommentId: string | null;
  /** Commenter's username when Meta includes one. */
  username: string | null;
  /** Original comment text. This must not be written to logs. */
  text: string;
  /** Time at which the application accepted the authenticated delivery. */
  receivedAt: Date;
}

/** One inbound Instagram DM, with content kept out of logs. */
export interface IncomingMessageEvent {
  /** Story being replied to; absent on ordinary Direct messages and quick-reply answers. */
  storyId?: string;
  /** Instagram professional account that received the message. */
  instagramAccountId: string;
  /** Meta message identifier used to deduplicate webhook retries. */
  messageId: string;
  /** Stable payload for a selected quick reply, or null for typed text. */
  quickReplyPayload: string | null;
  /** Instagram-scoped ID of the recipient professional account. */
  recipientId: string;
  /** Instagram-scoped ID of the person who sent the message. */
  senderId: string;
  /** Meta's message time, not the webhook receipt time. */
  timestamp: Date;
  /** Visible message text, or null when Meta sent only a quick-reply payload. */
  text: string | null;
}

const identifier = z.string().trim().min(1).max(128);
// Application defensive bound for opaque message IDs, not a provider specification.
const messageIdentifier = z.string().trim().min(1).max(1_024);
const commentValueSchema = z.object({
  from: z
    .object({
      id: identifier.optional(),
      username: z.string().trim().min(1).max(256).optional(),
    })
    .nullable()
    .optional(),
  id: identifier,
  media: z.object({ id: identifier }),
  parent_id: identifier.optional(),
  text: z.string().max(2_200),
});
const incomingMessageSchema = z.object({
  sender: z.object({ id: identifier }),
  recipient: z.object({ id: identifier }),
  timestamp: z.number().int().nonnegative().max(8_640_000_000_000_000),
  message: z.object({
    is_echo: z.boolean().optional(),
    mid: messageIdentifier,
    quick_reply: z.object({ payload: z.string().min(1).max(1_000) }).optional(),
    reply_to: z.object({ story: z.object({ id: identifier }).optional() }).optional(),
    text: z.string().max(2_200).optional(),
  }),
});
/** Fixed categories for rejected messaging events, without private payload details. */
export type MessagingRejectionReason =
  | 'invalid_message_id'
  | 'invalid_payload'
  | 'echo'
  | 'own_sender'
  | 'recipient_mismatch'
  | 'unsupported_content';

/** Creates independent counters for the first applicable rejection reason per messaging event. */
export const createMessagingRejectionCounts = (): Record<MessagingRejectionReason, number> => ({
  invalid_message_id: 0,
  invalid_payload: 0,
  echo: 0,
  own_sender: 0,
  recipient_mismatch: 0,
  unsupported_content: 0,
});

/** Safe categories for signed Instagram events this application does not process. */
export type UnsupportedWebhookEventKind = 'messaging' | 'other_change' | 'other_entry';
const envelopeSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(),
      id: identifier,
      messaging: z.array(z.unknown()).optional(),
    }),
  ),
  object: z.literal('instagram'),
});

/** Creates zeroed counts for signed Instagram events that this application does not process. */
export const createUnsupportedWebhookEventCounts = (): Record<
  UnsupportedWebhookEventKind,
  number
> => ({
  messaging: 0,
  other_change: 0,
  other_entry: 0,
});

/** Successful comment-event normalization result. */
export interface ValidCommentEventNormalization {
  /** Extracted comment events from the authenticated delivery. */
  events: CommentEvent[];
  /** Valid inbound DMs; quick replies and typed messages are included. */
  messageEvents: IncomingMessageEvent[];
  /** Fixed rejection counts without raw values, validation paths, or errors. */
  messagingRejectionCounts: Record<MessagingRejectionReason, number>;
  /** Aggregate unsupported-event categories without retaining any event payload values. */
  unsupportedEventCounts: Record<UnsupportedWebhookEventKind, number>;
  /** Identifies a successful normalization. */
  success: true;
}

/** Failed comment-event normalization result without raw payload details. */
export interface InvalidCommentEventNormalization {
  /** Identifies a rejected payload. */
  success: false;
}

/** Outcome of attempting to normalize an authenticated Meta delivery. */
export type CommentEventNormalization =
  InvalidCommentEventNormalization | ValidCommentEventNormalization;

/**
 * Validates a signed Meta envelope and extracts supported comment and inbound DM events.
 *
 * Valid but unsupported Instagram events are counted for observability and deliberately omitted from
 * processing. A malformed `comments` change remains invalid because it could otherwise hide a
 * broken comment delivery contract.
 */
export const normalizeCommentEvents = (
  payload: unknown,
  receivedAt: Date = new Date(),
): CommentEventNormalization => {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return { success: false };

  const events: CommentEvent[] = [];
  const messageEvents: IncomingMessageEvent[] = [];
  const unsupportedEventCounts = createUnsupportedWebhookEventCounts();
  const messagingRejectionCounts = createMessagingRejectionCounts();
  const rejectMessage = (reason: MessagingRejectionReason): void => {
    unsupportedEventCounts.messaging += 1;
    messagingRejectionCounts[reason] += 1;
  };
  for (const entry of envelope.data.entry) {
    const addIncomingMessage = (item: unknown): void => {
      const parsed = incomingMessageSchema.safeParse(item);
      if (!parsed.success) {
        rejectMessage(
          parsed.error.issues.some(
            (issue) => issue.path[0] === 'message' && issue.path[1] === 'mid',
          )
            ? 'invalid_message_id'
            : 'invalid_payload',
        );
        return;
      }
      const { message, sender, recipient, timestamp } = parsed.data;
      const text = message.text?.trim() ? message.text : null;
      const rejectionReason: MessagingRejectionReason | null =
        message.is_echo === true
          ? 'echo'
          : sender.id === entry.id
            ? 'own_sender'
            : recipient.id !== entry.id
              ? 'recipient_mismatch'
              : text === null && message.quick_reply === undefined
                ? 'unsupported_content'
                : null;
      if (rejectionReason) {
        rejectMessage(rejectionReason);
        return;
      }
      messageEvents.push({
        ...(message.reply_to?.story ? { storyId: message.reply_to.story.id } : {}),
        instagramAccountId: entry.id,
        messageId: message.mid,
        quickReplyPayload: message.quick_reply?.payload ?? null,
        recipientId: recipient.id,
        senderId: sender.id,
        timestamp: new Date(timestamp),
        text,
      });
    };
    const changes = entry.changes ?? [];
    for (const change of changes) {
      if (change.field === 'messages') {
        addIncomingMessage(change.value);
        continue;
      }
      if (change.field !== 'comments') {
        unsupportedEventCounts.other_change += 1;
        continue;
      }
      const comment = commentValueSchema.safeParse(change.value);
      if (!comment.success) return { success: false };
      events.push({
        commentId: comment.data.id,
        commenterId: comment.data.from?.id ?? null,
        instagramAccountId: entry.id,
        mediaId: comment.data.media.id,
        parentCommentId: comment.data.parent_id ?? null,
        receivedAt,
        text: comment.data.text,
        username: comment.data.from?.username ?? null,
      });
    }
    for (const item of entry.messaging ?? []) {
      addIncomingMessage(item);
    }
    if (changes.length === 0 && entry.messaging === undefined)
      unsupportedEventCounts.other_entry += 1;
  }
  return { events, messageEvents, messagingRejectionCounts, success: true, unsupportedEventCounts };
};
