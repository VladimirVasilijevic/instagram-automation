import { z } from 'zod';

/** One authenticated Facebook Page comment event. */
export interface FacebookCommentEvent {
  /** Page receiving the comment. */
  pageId: string;
  /** Opaque Page post ID selected by an automation. */
  postId: string;
  /** Comment ID used as a provider-scoped idempotency key. */
  commentId: string;
  /** Parent comment ID for a nested reply, or null for a top-level comment. */
  parentCommentId: string | null;
  /** Comment author ID, when Meta provides it. */
  commenterId: string | null;
  /** Comment author name, when Meta provides it. */
  commenterName: string | null;
  /** Comment text; never write it to logs. */
  text: string;
  /** Time the application accepted the signed event. */
  receivedAt: Date;
}

/** One authenticated Messenger message sent to a Facebook Page. */
export interface FacebookIncomingMessageEvent {
  /** Receiving Page ID. */
  pageId: string;
  /** Messenger message ID for deduplication. */
  messageId: string;
  /** Page-scoped sender ID. */
  senderId: string;
  /** Receiving Page ID supplied by Meta. */
  recipientId: string;
  /** Selected quick-reply payload or null for typed text. */
  quickReplyPayload: string | null;
  /** Message text or null when only a quick-reply payload is supplied. */
  text: string | null;
  /** Message timestamp from Meta. */
  timestamp: Date;
}

/** Counts signed but unsupported Facebook webhook content without retaining payloads. */
export interface FacebookUnsupportedEventCounts {
  /** Other Page feed changes, such as new posts or edited comments. */
  feed: number;
  /** Unrecognized Page webhook fields. */
  otherChange: number;
  /** Unsupported Messenger events, echoes, and malformed messages. */
  messaging: number;
}

/** Valid normalized Page webhook. */
export interface ValidFacebookWebhookNormalization {
  /** Supported new Page comments. */
  comments: FacebookCommentEvent[];
  /** Supported inbound Messenger text and quick-reply events. */
  messages: FacebookIncomingMessageEvent[];
  /** Safe counts of unsupported signed events. */
  unsupported: FacebookUnsupportedEventCounts;
  /** Successful normalization marker. */
  success: true;
}

/** Invalid Page webhook envelope or malformed target comment. */
export interface InvalidFacebookWebhookNormalization {
  /** Failed normalization marker. */
  success: false;
}

/** Result of parsing a signed Facebook Page webhook. */
export type FacebookWebhookNormalization =
  ValidFacebookWebhookNormalization | InvalidFacebookWebhookNormalization;

const id = z.string().trim().min(1).max(128);
const envelopeSchema = z.object({
  object: z.literal('page'),
  entry: z.array(
    z.object({
      id,
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(),
      messaging: z.array(z.unknown()).optional(),
    }),
  ),
});
const feedValueSchema = z.object({
  item: z.literal('comment'),
  verb: z.literal('add'),
  comment_id: id,
  post_id: id,
  parent_id: id.optional(),
  message: z.string().max(10_000).optional(),
  from: z
    .object({ id: id.optional(), name: z.string().trim().min(1).max(256).optional() })
    .nullable()
    .optional(),
});
const messageSchema = z.object({
  sender: z.object({ id }),
  recipient: z.object({ id }),
  timestamp: z.number().int().nonnegative().max(8_640_000_000_000_000),
  message: z.object({
    mid: id,
    is_echo: z.boolean().optional(),
    quick_reply: z.object({ payload: z.string().min(1).max(1_000) }).optional(),
    text: z.string().max(10_000).optional(),
  }),
});

/** Normalizes signed Page feed comments and Messenger answers. */
export const normalizeFacebookWebhookEvents = (
  payload: unknown,
  receivedAt: Date = new Date(),
): FacebookWebhookNormalization => {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return { success: false };

  const comments: FacebookCommentEvent[] = [];
  const messages: FacebookIncomingMessageEvent[] = [];
  const unsupported: FacebookUnsupportedEventCounts = { feed: 0, messaging: 0, otherChange: 0 };
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'feed') {
        unsupported.otherChange += 1;
        continue;
      }
      const value = change.value;
      if (
        !value ||
        typeof value !== 'object' ||
        !('item' in value) ||
        value.item !== 'comment' ||
        !('verb' in value) ||
        value.verb !== 'add'
      ) {
        unsupported.feed += 1;
        continue;
      }
      const parsed = feedValueSchema.safeParse(value);
      if (!parsed.success) return { success: false };
      const comment = parsed.data;
      comments.push({
        pageId: entry.id,
        postId: comment.post_id,
        commentId: comment.comment_id,
        parentCommentId:
          comment.parent_id && comment.parent_id !== comment.post_id ? comment.parent_id : null,
        commenterId: comment.from?.id ?? null,
        commenterName: comment.from?.name ?? null,
        text: comment.message ?? '',
        receivedAt,
      });
    }
    for (const item of entry.messaging ?? []) {
      const parsed = messageSchema.safeParse(item);
      if (!parsed.success) {
        unsupported.messaging += 1;
        continue;
      }
      const { sender, recipient, message, timestamp } = parsed.data;
      const text = message.text?.trim() ? message.text : null;
      if (
        message.is_echo === true ||
        sender.id === entry.id ||
        recipient.id !== entry.id ||
        (text === null && message.quick_reply === undefined)
      ) {
        unsupported.messaging += 1;
        continue;
      }
      messages.push({
        pageId: entry.id,
        messageId: message.mid,
        senderId: sender.id,
        recipientId: recipient.id,
        quickReplyPayload: message.quick_reply?.payload ?? null,
        text,
        timestamp: new Date(timestamp),
      });
    }
  }
  return { success: true, comments, messages, unsupported };
};
