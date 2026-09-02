import { useEffect, useState } from 'react';

import { getApiHealth, getDatabaseHealth } from './api/health.js';
import { StatusCard, type StatusCardState } from './components/StatusCard.js';

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
 * Renders the Milestone 1 infrastructure status page.
 *
 * @returns A mobile-first page with independent API and database health states.
 */
export const App = () => {
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#ffffff_0%,_#f6f7fb_45%,_#eef1f7_100%)] px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <header>
          <p className="text-sm font-semibold tracking-wide text-indigo-700 uppercase">
            Milestone 1
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Instagram Automation
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            Local infrastructure status for the frontend, API, and PostgreSQL connection.
          </p>
        </header>

        <div className="mt-8 grid gap-4" aria-live="polite" aria-busy={isRefreshing}>
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
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={isRefreshing}
            onClick={() => void refreshStatus()}
          >
            {isRefreshing ? 'Checking status…' : 'Refresh status'}
          </button>
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none"
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
          >
            Open API documentation
          </a>
        </div>

        <footer className="mt-10 border-t border-slate-200 pt-5 text-sm text-slate-500">
          React application using same-origin HTTP paths and standard browser APIs.
        </footer>
      </div>
    </main>
  );
};
