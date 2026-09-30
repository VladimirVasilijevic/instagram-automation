/** Serialized delivery channels persisted for one Instagram comment. */
export const DELIVERY_CHANNEL = {
  /** Private message authorized by a matching comment. */
  PRIVATE: 'private',
  /** Public reply below a matching comment. */
  PUBLIC: 'public',
} as const;

/** One independently tracked public or private reply channel. */
export type DeliveryChannel = (typeof DELIVERY_CHANNEL)[keyof typeof DELIVERY_CHANNEL];

/** Owner-selectable delivery modes persisted with an automation. */
export const DELIVERY_MODE = {
  /** Send both public and private deliveries. */
  BOTH: 'both',
  /** Send only the private delivery. */
  PRIVATE: DELIVERY_CHANNEL.PRIVATE,
  /** Send only the public delivery. */
  PUBLIC: DELIVERY_CHANNEL.PUBLIC,
} as const;

/** Selected delivery behavior for one automation. */
export type DeliveryMode = (typeof DELIVERY_MODE)[keyof typeof DELIVERY_MODE];

/** Owner-selectable rules for deciding whether a top-level comment qualifies. */
export const TRIGGER_MODE = {
  /** Match every top-level comment after the standard safety exclusions. */
  ALL: 'all',
  /** Match a complete word or hashtag anywhere in the comment. */
  CONTAINS: 'contains',
  /** Match the complete trimmed comment text. */
  EXACT: 'exact',
} as const;

/** Selected comment-matching behavior for one automation. */
export type TriggerMode = (typeof TRIGGER_MODE)[keyof typeof TRIGGER_MODE];

/** Serialized execution states persisted for each delivery channel. */
export const EXECUTION_STATUS = {
  /** Delivery reached a terminal failure. */
  FAILED: 'failed',
  /** Delivery is owned by an active processing lease. */
  PROCESSING: 'processing',
  /** Delivery is waiting for a controlled retry. */
  RETRY_PENDING: 'retry_pending',
  /** Meta confirmed the delivery. */
  SUCCEEDED: 'succeeded',
  /** Delivery may have completed and requires manual review. */
  UNCERTAIN: 'uncertain',
} as const;

/** Current lifecycle state of one delivery execution. */
export type ExecutionStatus = (typeof EXECUTION_STATUS)[keyof typeof EXECUTION_STATUS];

/** Serialized owner-visible states for scheduled maintenance. */
export const MAINTENANCE_STATUS = {
  /** The latest pass completed recently but reported actionable work. */
  ATTENTION: 'attention',
  /** No successful pass completed within the expected scheduler window. */
  DELAYED: 'delayed',
  /** A recent pass completed without actionable results. */
  HEALTHY: 'healthy',
  /** No successful pass has been recorded. */
  NEVER_RUN: 'never_run',
} as const;

/** Current owner-visible scheduled-maintenance state. */
export type MaintenanceStatus = (typeof MAINTENANCE_STATUS)[keyof typeof MAINTENANCE_STATUS];

/** Returns whether an unknown value is a supported delivery channel. */
export const isDeliveryChannel = (value: unknown): value is DeliveryChannel =>
  typeof value === 'string' && Object.values(DELIVERY_CHANNEL).includes(value as DeliveryChannel);

/** Returns whether an unknown value is a supported delivery mode. */
export const isDeliveryMode = (value: unknown): value is DeliveryMode =>
  typeof value === 'string' && Object.values(DELIVERY_MODE).includes(value as DeliveryMode);

/** Returns whether an unknown value is a supported comment trigger mode. */
export const isTriggerMode = (value: unknown): value is TriggerMode =>
  typeof value === 'string' && Object.values(TRIGGER_MODE).includes(value as TriggerMode);

/** Returns whether an unknown value is a supported execution status. */
export const isExecutionStatus = (value: unknown): value is ExecutionStatus =>
  typeof value === 'string' && Object.values(EXECUTION_STATUS).includes(value as ExecutionStatus);

/** Returns whether an unknown value is a supported maintenance state. */
export const isMaintenanceStatus = (value: unknown): value is MaintenanceStatus =>
  typeof value === 'string' &&
  Object.values(MAINTENANCE_STATUS).includes(value as MaintenanceStatus);
