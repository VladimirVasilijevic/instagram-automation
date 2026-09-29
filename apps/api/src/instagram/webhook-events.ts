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

const identifier = z.string().trim().min(1).max(128);
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
 * Validates a signed Meta envelope and extracts supported comment changes.
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
  const unsupportedEventCounts = createUnsupportedWebhookEventCounts();
  for (const entry of envelope.data.entry) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      if (change.field !== 'comments') continue;
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
    unsupportedEventCounts.other_change += changes.filter(
      (change) => change.field !== 'comments',
    ).length;
    unsupportedEventCounts.messaging += entry.messaging?.length ?? 0;
    if (changes.length === 0 && entry.messaging === undefined)
      unsupportedEventCounts.other_entry += 1;
  }
  return { events, success: true, unsupportedEventCounts };
};
