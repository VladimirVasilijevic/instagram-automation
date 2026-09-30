import { useEffect, useState } from 'react';

import { getApiHealth, getDatabaseHealth } from '../api/health.js';
import { StatusCard, type StatusCardState } from '../components/StatusCard.js';
import { PageShell } from '../components/ui/PageShell.js';

const serviceDescriptions: Record<'api' | 'database', Record<StatusCardState, string>> = {
  api: {
    connected: 'The Hono API is accepting browser requests.',
    loading: 'Checking whether the Hono API is available.',
    unavailable: 'The API could not be reached or returned an unexpected response.',
  },
  database: {
    connected: 'The API completed a live PostgreSQL health query.',
    loading: 'Running a database connectivity check through the API.',
    unavailable: 'The database health check is currently unavailable.',
  },
};

/**
 * Renders the public live API and database status page.
 *
 * @returns A mobile-first page with independent API and database health states.
 */
export const StatusPage = () => {
  const [apiState, setApiState] = useState<StatusCardState>('loading');
  const [databaseState, setDatabaseState] = useState<StatusCardState>('loading');

  const refreshStatus = async (signal?: AbortSignal): Promise<void> => {
    setApiState('loading');
    setDatabaseState('loading');

    const apiCheck = getApiHealth(signal)
      .then(() => {
        if (!signal?.aborted) setApiState('connected');
      })
      .catch(() => {
        if (!signal?.aborted) setApiState('unavailable');
      });

    const databaseCheck = getDatabaseHealth(signal)
      .then((response) => {
        if (!signal?.aborted) {
          setDatabaseState(response.database === 'connected' ? 'connected' : 'unavailable');
        }
      })
      .catch(() => {
        if (!signal?.aborted) setDatabaseState('unavailable');
      });

    await Promise.all([apiCheck, databaseCheck]);
  };

  useEffect(() => {
    const controller = new AbortController();
    void refreshStatus(controller.signal);

    return () => controller.abort();
  }, []);

  const isRefreshing = apiState === 'loading' || databaseState === 'loading';

  return (
    <PageShell>
      <div className="mx-auto max-w-2xl">
        <header>
          <p className="text-sm font-semibold tracking-wide text-[#5632a8] uppercase">
            Service health
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#292638] sm:text-4xl">
            Service status
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-[#625b6e]">
            Live checks for the API and database connection.
          </p>
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-live="polite" aria-busy={isRefreshing}>
          <StatusCard
            description={serviceDescriptions.api[apiState]}
            state={apiState}
            title="API"
          />
          <StatusCard
            description={serviceDescriptions.database[databaseState]}
            state={databaseState}
            title="Database"
          />
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            className="ui-button w-full sm:w-auto"
            type="button"
            disabled={isRefreshing}
            onClick={() => void refreshStatus()}
          >
            {isRefreshing ? 'Checking status…' : 'Refresh status'}
          </button>
          <a
            className="ui-button-secondary w-full sm:w-auto"
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
          >
            Open API documentation
          </a>
        </div>

        <footer className="mt-10 border-t border-[var(--app-border)] pt-5 text-sm text-[#625b6e]">
          React application using same-origin HTTP paths and standard browser APIs.
        </footer>
      </div>
    </PageShell>
  );
};
