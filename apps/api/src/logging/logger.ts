/** Server-side structured logging operations used by the API. */
export interface Logger {
  /** Records an error without requiring raw exceptions or secret values. */
  error(message: string, context?: Readonly<Record<string, string>>): void;

  /** Records an informational lifecycle event. */
  info(message: string, context?: Readonly<Record<string, string | number>>): void;
}

/** Default console-backed logger for the Node.js API process. */
export const logger: Logger = {
  error(message, context) {
    console.error(message, context ?? {});
  },
  info(message, context) {
    console.info(message, context ?? {});
  },
};

/**
 * Converts an unknown exception into context safe for server-side logging.
 *
 * @param error - Caught value that must not be logged directly.
 * @returns Context containing only the exception class name.
 */
export const toSafeErrorContext = (error: unknown): Readonly<Record<string, string>> => ({
  errorName: error instanceof Error ? error.name : 'UnknownError',
});
