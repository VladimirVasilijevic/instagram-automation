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
const envelopeSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
      id: identifier,
    }),
  ),
  object: z.literal('instagram'),
});

/** Successful comment-event normalization result. */
export interface ValidCommentEventNormalization {
  /** Extracted comment events from the authenticated delivery. */
  events: CommentEvent[];
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

/** Validates a signed Meta envelope and extracts only supported Instagram comment changes. */
export const normalizeCommentEvents = (
  payload: unknown,
  receivedAt: Date = new Date(),
): CommentEventNormalization => {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return { success: false };

  const events: CommentEvent[] = [];
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
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
  }
  return { events, success: true };
};
