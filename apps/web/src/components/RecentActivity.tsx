import { useEffect, useState } from 'react';

import { DELIVERY_CHANNEL, EXECUTION_STATUS } from '@instagram-automation/contracts';

import {
  getRecentExecutions,
  type ExecutionActivity,
  type ExecutionDeliveryActivity,
} from '../api/executions.js';

type ActivityState =
  | { status: 'loading' }
  | { status: 'ready'; executions: ExecutionActivity[] }
  | { status: 'error' };

const buttonStyle =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const statusStyle: Record<ExecutionDeliveryActivity['status'], string> = {
  [EXECUTION_STATUS.FAILED]: 'bg-red-50 text-red-800',
  [EXECUTION_STATUS.PROCESSING]: 'bg-amber-50 text-amber-900',
  [EXECUTION_STATUS.RETRY_PENDING]: 'bg-blue-50 text-blue-900',
  [EXECUTION_STATUS.SUCCEEDED]: 'bg-emerald-50 text-emerald-800',
  [EXECUTION_STATUS.UNCERTAIN]: 'bg-orange-50 text-orange-900',
};
const statusText: Record<ExecutionDeliveryActivity['status'], string> = {
  [EXECUTION_STATUS.FAILED]: 'Failed',
  [EXECUTION_STATUS.PROCESSING]: 'Processing',
  [EXECUTION_STATUS.RETRY_PENDING]: 'Retry scheduled',
  [EXECUTION_STATUS.SUCCEEDED]: 'Succeeded',
  [EXECUTION_STATUS.UNCERTAIN]: 'Review needed',
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
  const [copiedUsername, setCopiedUsername] = useState<string | null>(null);

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

  const copyUsername = async (username: string) => {
    try {
      await navigator.clipboard.writeText(username);
      setCopiedUsername(username);
    } catch {
      setCopiedUsername(null);
    }
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
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <p className="font-semibold break-words text-slate-950">
                    {execution.commenterUsername
                      ? `@${execution.commenterUsername}`
                      : 'Instagram user'}
                  </p>
                  {execution.commenterUsername && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className={buttonStyle}
                        type="button"
                        onClick={() => void copyUsername(execution.commenterUsername!)}
                      >
                        {copiedUsername === execution.commenterUsername
                          ? 'Username copied'
                          : 'Copy username'}
                      </button>
                      <a
                        className={buttonStyle}
                        href={`https://www.instagram.com/${encodeURIComponent(execution.commenterUsername)}/`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open Instagram profile
                      </a>
                    </div>
                  )}
                </div>
                <time className="text-sm text-slate-500" dateTime={execution.createdAt}>
                  {formatTimestamp(execution.createdAt)}
                </time>
              </div>
              <div className="mt-3 min-w-0">
                <p className="mt-1 break-words text-slate-700">{execution.commentText}</p>
                <ul className="mt-3 grid gap-2" aria-label="Delivery results">
                  {execution.deliveries.map((delivery) => (
                    <li
                      className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-center"
                      key={delivery.channel}
                    >
                      <span className="font-medium text-slate-900">
                        {delivery.channel === DELIVERY_CHANNEL.PUBLIC
                          ? 'Public reply'
                          : 'Private DM'}
                      </span>
                      <span
                        className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-medium ${statusStyle[delivery.status]}`}
                      >
                        {statusText[delivery.status]}
                      </span>
                      <span className="text-sm text-slate-600">
                        {delivery.status === EXECUTION_STATUS.SUCCEEDED && 'Message sent'}
                        {delivery.status === EXECUTION_STATUS.PROCESSING &&
                          'Message is being processed'}
                        {delivery.status === EXECUTION_STATUS.RETRY_PENDING &&
                          (delivery.errorMessage ?? 'A controlled retry is scheduled.')}
                        {delivery.status === EXECUTION_STATUS.UNCERTAIN &&
                          (delivery.errorMessage ??
                            'Delivery was not retried because it may create a duplicate message.')}
                        {delivery.status === EXECUTION_STATUS.FAILED &&
                          (delivery.errorMessage ?? 'The message could not be sent.')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
