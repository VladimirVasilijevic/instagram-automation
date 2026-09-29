import { RECOVERY_KIND, type RecoveryKind } from '../automation/recovery.js';

/** Provider diagnostics used to choose a conservative reply-recovery action. */
export interface InstagramReplyFailureDiagnostics {
  /** HTTP response status when Meta responded. */
  httpStatus?: number;
  /** Numeric Meta error code when supplied. */
  metaErrorCode?: number;
  /** Transport or response failure category. */
  reason: 'http_error' | 'invalid_json' | 'invalid_response' | 'network_error' | 'timeout';
}

/** Classifies a reply failure without treating every permission rejection as an expired token. */
export const classifyInstagramReplyFailure = (
  diagnostics: InstagramReplyFailureDiagnostics,
): RecoveryKind => {
  if (diagnostics.reason !== 'http_error') return RECOVERY_KIND.UNCERTAIN;
  if (diagnostics.httpStatus === 401 || diagnostics.metaErrorCode === 190)
    return RECOVERY_KIND.AUTHENTICATION;
  if (diagnostics.httpStatus === 429) return RECOVERY_KIND.RETRYABLE;
  if (
    diagnostics.httpStatus !== undefined &&
    diagnostics.httpStatus >= 400 &&
    diagnostics.httpStatus < 500
  )
    return RECOVERY_KIND.PERMANENT;
  return RECOVERY_KIND.UNCERTAIN;
};
