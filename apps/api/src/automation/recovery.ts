/** Provider recovery classifications used by public and private reply delivery. */
export const RECOVERY_KIND = {
  /** Provider rejected the token and the account must reconnect. */
  AUTHENTICATION: 'authentication',
  /** Provider definitively rejected the operation. */
  PERMANENT: 'permanent',
  /** Provider definitively requested a later retry. */
  RETRYABLE: 'retryable',
  /** Provider outcome is ambiguous and must not be retried automatically. */
  UNCERTAIN: 'uncertain',
} as const;

/** Conservative automatic-recovery decision for a provider failure. */
export type RecoveryKind = (typeof RECOVERY_KIND)[keyof typeof RECOVERY_KIND];
