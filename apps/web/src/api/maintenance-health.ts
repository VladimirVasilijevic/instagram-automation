import { isMaintenanceStatus, type MaintenanceStatus } from '@instagram-automation/contracts';

/** Safe aggregate counters from the latest completed maintenance pass. */
export interface MaintenanceCounts {
  /** Accounts found after credential expiry. */
  expiredTokenCount: number;
  /** Connections requiring owner reconnection. */
  reconnectRequiredCount: number;
  /** Reply attempts that reached terminal failure. */
  replyFailedCount: number;
  /** Reply attempts waiting for controlled retry. */
  replyRetryPendingCount: number;
  /** Reply attempts confirmed successful. */
  replySucceededCount: number;
  /** Ambiguous reply attempts stopped for review. */
  replyUncertainCount: number;
  /** Expired processing leases resolved. */
  staleExecutionCount: number;
  /** Token refresh attempts deferred after temporary failure. */
  tokenRefreshFailedCount: number;
  /** Tokens successfully refreshed. */
  tokenRefreshedCount: number;
}

/** Owner-visible durable scheduler health response. */
export interface MaintenanceHealth {
  /** Database or server observation time. */
  checkedAt: string;
  /** Safe latest aggregate results. */
  counts: MaintenanceCounts;
  /** Latest failed invocation time. */
  lastFailedAt: string | null;
  /** Safe code for the latest failed invocation. */
  lastFailureCode: string | null;
  /** Latest full-pass completion time. */
  lastSucceededAt: string | null;
  /** Current scheduler-health classification. */
  status: MaintenanceStatus;
}

const countNames = [
  'expiredTokenCount',
  'reconnectRequiredCount',
  'replyFailedCount',
  'replyRetryPendingCount',
  'replySucceededCount',
  'replyUncertainCount',
  'staleExecutionCount',
  'tokenRefreshFailedCount',
  'tokenRefreshedCount',
] as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const isNullableTimestamp = (value: unknown): value is string | null =>
  value === null || isTimestamp(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const hasValidCounts = (value: unknown): value is Record<(typeof countNames)[number], number> =>
  isRecord(value) &&
  countNames.every((name) => Number.isInteger(value[name]) && (value[name] as number) >= 0);

const parseHealth = (value: unknown): MaintenanceHealth => {
  if (
    !isRecord(value) ||
    !isTimestamp(value.checkedAt) ||
    !hasValidCounts(value.counts) ||
    !isNullableTimestamp(value.lastFailedAt) ||
    !isNullableString(value.lastFailureCode) ||
    !isNullableTimestamp(value.lastSucceededAt) ||
    !isMaintenanceStatus(value.status)
  )
    throw new Error('Invalid maintenance health');
  return value as unknown as MaintenanceHealth;
};

/** Loads durable maintenance health using the existing same-origin application session. */
export const getMaintenanceHealth = async (signal?: AbortSignal): Promise<MaintenanceHealth> => {
  let response: Response;
  try {
    const deadline = AbortSignal.timeout(10_000);
    response = await fetch('/api/maintenance-health', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch (error) {
    throw new Error('Maintenance health is unavailable. Please try again.', { cause: error });
  }
  if (!response.ok) throw new Error('Maintenance health is unavailable. Please try again.');
  try {
    return parseHealth(await response.json());
  } catch (error) {
    throw new Error('Maintenance health returned an invalid response. Please try again.', {
      cause: error,
    });
  }
};
