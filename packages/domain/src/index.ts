import { TRIGGER_MODE, type TriggerMode } from '@instagram-automation/contracts';

/** Provider-independent comment fields used by an automation rule. */
export interface RuleComment {
  /** Connected social account that owns the comment. */
  connectionExternalId: string;
  /** External author ID when supplied by the provider. */
  authorExternalId: string | null;
  /** External author name when supplied by the provider. */
  authorName: string | null;
  /** Parent comment ID, or null for a comment directly on media. */
  parentCommentId: string | null;
  /** Original comment text. */
  text: string;
}

/** Provider-independent owner identity required for comment safety checks. */
export interface RuleOwner {
  /** External identifier of the connected social account. */
  externalId: string;
  /** Connected account name, when available. */
  name: string | null;
}

/** Owner-configured rule used to select eligible comments. */
export interface CommentRule {
  /** Match all, exact text, or a complete word or hashtag. */
  mode: TriggerMode;
  /** Configured text for exact and contains modes. */
  text: string | null;
}

/** Safe reason why a comment cannot trigger a reply. */
export type CommentExclusion = 'nested_comment' | 'own_comment' | 'trigger_not_matched';

/** Excludes nested comments and comments authored by the connected account. */
export const getCommentSafetyExclusion = (
  comment: RuleComment,
  owner: RuleOwner,
): Exclude<CommentExclusion, 'trigger_not_matched'> | null => {
  if (comment.parentCommentId) return 'nested_comment';
  if (
    comment.authorExternalId === owner.externalId ||
    (comment.authorName !== null &&
      owner.name !== null &&
      comment.authorName.toLowerCase() === owner.name.toLowerCase())
  )
    return 'own_comment';
  return null;
};

/** Applies the shared safety and trigger rules to a normalized social comment. */
export const evaluateComment = (
  comment: RuleComment,
  owner: RuleOwner,
  rule: CommentRule,
): CommentExclusion | null => {
  const safetyExclusion = getCommentSafetyExclusion(comment, owner);
  if (safetyExclusion) return safetyExclusion;

  const normalizedText = comment.text.trim().toLowerCase();
  const normalizedTrigger = rule.text?.toLowerCase() ?? null;
  const tokens: string[] = normalizedText.match(/#[\p{L}\p{N}_]+|[\p{L}\p{N}_]+/gu) ?? [];
  const matched =
    rule.mode === TRIGGER_MODE.ALL ||
    (rule.mode === TRIGGER_MODE.EXACT && normalizedText === normalizedTrigger) ||
    (rule.mode === TRIGGER_MODE.CONTAINS &&
      normalizedTrigger !== null &&
      tokens.includes(normalizedTrigger));
  return matched ? null : 'trigger_not_matched';
};
