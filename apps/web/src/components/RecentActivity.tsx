import { useEffect, useState } from 'react';

import { getRecentExecutions, type ExecutionActivity } from '../api/executions.js';

type ActivityState =
  | { status: 'loading' }
  | { status: 'ready'; executions: ExecutionActivity[] }
  | { status: 'error' };

const buttonStyle =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const statusStyle: Record<ExecutionActivity['status'], string> = {
  failed: 'bg-red-50 text-red-800',
  processing: 'bg-amber-50 text-amber-900',
  succeeded: 'bg-emerald-50 text-emerald-800',
};
const statusText: Record<ExecutionActivity['status'], string> = {
  failed: 'Failed',
  processing: 'Processing',
  succeeded: 'Succeeded',
};

const formatTimestamp = (createdAt: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(createdAt),
  );

/** Renders safe, account-owned automation results with a manual refresh control. */
export const RecentActivity = () => {
  const [state, setState] = useState<ActivityState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void getRecentExecutions(controller.signal)
      .then((executions) => {
        if (!controller.signal.aborted) setState({ status: 'ready', executions });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => controller.abort();
  }, [attempt]);

  const refresh = () => {
    setRefreshing(true);
    setAttempt((value) => value + 1);
  };

  return (
    <section className="mt-8 border-t border-slate-200 pt-8" aria-live="polite">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-xl font-semibold text-slate-950">Recent activity</h3>
          <p className="mt-2 leading-7 text-slate-600">Your latest automated comment results.</p>
        </div>
        <button className={buttonStyle} type="button" disabled={refreshing} onClick={refresh}>
          {refreshing ? 'Refreshing…' : 'Refresh activity'}
        </button>
      </div>

      {state.status === 'loading' && (
        <p role="status" className="mt-6 text-slate-600">
          Loading recent activity…
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-6">
          <p role="alert" className="text-slate-700">
            We could not load your activity. Please try again.
          </p>
          <button className={`${buttonStyle} mt-4`} type="button" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {state.status === 'ready' && state.executions.length === 0 && (
        <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          No automation activity yet.
        </p>
      )}
      {state.status === 'ready' && state.executions.length > 0 && (
        <ul className="mt-6 grid gap-3" aria-label="Recent automation activity">
          {state.executions.map((execution) => (
            <li
              key={`${execution.createdAt}-${execution.commentText}`}
              className="rounded-xl border border-slate-200 bg-white p-4 sm:grid sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4"
            >
              <span
                className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${statusStyle[execution.status]}`}
              >
                {statusText[execution.status]}
              </span>
              <div className="mt-3 min-w-0 sm:mt-0">
                <p className="font-semibold break-words text-slate-950">
                  {execution.commenterUsername
                    ? `@${execution.commenterUsername}`
                    : 'Instagram user'}
                </p>
                <p className="mt-1 break-words text-slate-700">{execution.commentText}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {execution.status === 'succeeded' && 'Reply sent'}
                  {execution.status === 'processing' && 'Reply is being processed'}
                  {execution.status === 'failed' &&
                    (execution.errorMessage ?? 'The public reply could not be sent.')}
                </p>
              </div>
              <time
                className="mt-3 block text-sm text-slate-500 sm:mt-0"
                dateTime={execution.createdAt}
              >
                {formatTimestamp(execution.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
