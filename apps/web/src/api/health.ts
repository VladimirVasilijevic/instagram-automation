/** Successful response returned by the process health endpoint. */
export interface ApiHealthResponse {
  /** Process health state. */
  status: 'ok';
}

/** Successful response returned by the database health endpoint. */
export interface DatabaseConnectedResponse {
  /** Database connection state. */
  database: 'connected';

  /** Overall health state. */
  status: 'ok';
}

/** Sanitized unavailable response returned by the database health endpoint. */
export interface DatabaseUnavailableResponse {
  /** Database connection state. */
  database: 'unavailable';

  /** Overall health state. */
  status: 'error';
}

/** Possible documented response values from the database health endpoint. */
export type DatabaseHealthResponse = DatabaseConnectedResponse | DatabaseUnavailableResponse;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readJson = async (response: Response, serviceName: string): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new Error(`${serviceName} returned an invalid response`);
  }
};

const fetchHealthResponse = async (path: string, serviceName: string, signal?: AbortSignal) => {
  try {
    return await fetch(path, {
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    throw new Error(`${serviceName} is unavailable`, { cause: error });
  }
};

/**
 * Requests the API process health using a same-origin relative URL.
 *
 * @param signal - Optional cancellation signal for the browser request.
 * @returns The validated successful process health response.
 * @throws When the service is unavailable or returns an unexpected response.
 */
export const getApiHealth = async (signal?: AbortSignal): Promise<ApiHealthResponse> => {
  const response = await fetchHealthResponse('/api/health', 'API', signal);
  const payload = await readJson(response, 'API');

  if (!response.ok || !isRecord(payload) || payload.status !== 'ok') {
    throw new Error('API is unavailable');
  }

  return { status: 'ok' };
};

/**
 * Requests PostgreSQL connectivity through the API using a same-origin relative URL.
 *
 * @param signal - Optional cancellation signal for the browser request.
 * @returns A validated connected or unavailable database health response.
 * @throws When the API cannot provide a documented database health response.
 */
export const getDatabaseHealth = async (signal?: AbortSignal): Promise<DatabaseHealthResponse> => {
  const response = await fetchHealthResponse('/api/health/database', 'Database', signal);
  const payload = await readJson(response, 'Database');

  if (
    response.ok &&
    isRecord(payload) &&
    payload.status === 'ok' &&
    payload.database === 'connected'
  ) {
    return { database: 'connected', status: 'ok' };
  }

  if (
    response.status === 503 &&
    isRecord(payload) &&
    payload.status === 'error' &&
    payload.database === 'unavailable'
  ) {
    return { database: 'unavailable', status: 'error' };
  }

  throw new Error('Database status is unavailable');
};
