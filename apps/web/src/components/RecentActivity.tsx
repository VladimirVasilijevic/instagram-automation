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
type ActivityView = 'selected-post' | 'all-activity';

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
export const RecentActivity = ({
  selectedMediaId,
}: {
  selectedMediaId: string | null | undefined;
}) => {
  const [state, setState] = useState<ActivityState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<ActivityView>('selected-post');
  const [refreshing, setRefreshing] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState<string | null>(null);
  const activityMediaId = view === 'selected-post' ? selectedMediaId : undefined;

  useEffect(() => {
    if (view === 'selected-post' && activityMediaId === undefined) {
      setState({ status: 'loading' });
      setRefreshing(false);
      return;
    }
    if (view === 'selected-post' && activityMediaId === null) {
      setState({ status: 'ready', executions: [] });
      setRefreshing(false);
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });
    void getRecentExecutions(controller.signal, activityMediaId ?? undefined)
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
  }, [activityMediaId, attempt, view]);

  const refresh = () => {
    if (view === 'selected-post' && !selectedMediaId) return;
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
    <section className="ui-card p-5 sm:p-6" aria-live="polite" aria-labelledby="activity-heading">
      <span className="sr-only" role="status">
        {copiedUsername ? `Copied ${copiedUsername}` : ''}
      </span>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#5632a8] uppercase">Results</p>
          <h2 id="activity-heading" className="mt-1 text-xl font-semibold text-[#292638]">
            Recent activity
          </h2>
          <p className="mt-2 leading-6 text-[#625b6e]">Your latest automated comment results.</p>
        </div>
        <div className="grid gap-2 sm:justify-items-end">
          <div
            aria-label="Activity view"
            className="grid grid-cols-2 rounded-xl border border-[var(--app-border)] bg-[#f5f2ed] p-1"
            role="group"
          >
            <button
              aria-pressed={view === 'selected-post'}
              className={`ui-focus min-h-11 rounded-lg px-3 text-sm font-medium ${
                view === 'selected-post' ? 'bg-white text-[#432487] shadow-sm' : 'text-[#625b6e]'
              }`}
              type="button"
              onClick={() => setView('selected-post')}
            >
              Selected post
            </button>
            <button
              aria-pressed={view === 'all-activity'}
              aria-label="All recent activity"
              className={`ui-focus min-h-11 rounded-lg px-2 text-sm font-medium sm:px-3 ${
                view === 'all-activity' ? 'bg-white text-[#432487] shadow-sm' : 'text-[#625b6e]'
              }`}
              type="button"
              onClick={() => setView('all-activity')}
            >
              All activity
            </button>
          </div>
          <button
            className="ui-button-secondary w-full shrink-0 sm:w-auto"
            type="button"
            disabled={refreshing || (view === 'selected-post' && !selectedMediaId)}
            onClick={refresh}
          >
            {refreshing ? 'Refreshing…' : 'Refresh activity'}
          </button>
        </div>
      </div>

      {state.status === 'loading' && (
        <p role="status" className="mt-6 text-slate-600">
          {view === 'selected-post' && selectedMediaId === undefined
            ? 'Loading your selected post…'
            : 'Loading recent activity…'}
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-6">
          <p role="alert" className="ui-alert ui-alert-error">
            We could not load your activity. Please try again.
          </p>
          <button
            className="ui-button-secondary mt-4 w-full sm:w-auto"
            type="button"
            onClick={refresh}
          >
            Try again
          </button>
        </div>
      )}
      {state.status === 'ready' && state.executions.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-[var(--app-border)] bg-[#f5f2ed] p-5 text-sm text-[#625b6e]">
          {view === 'selected-post' && selectedMediaId === null
            ? 'Select a post in Automation setup to view its activity.'
            : view === 'selected-post'
              ? 'No activity for this post yet. Matching comments will appear here after delivery starts.'
              : 'No automation activity yet. Matching comments will appear here after delivery starts.'}
        </p>
      )}
      {state.status === 'ready' &&
        view === 'all-activity' &&
        state.executions.some((execution) => execution.mediaId === null) && (
          <p className="mt-4 text-sm text-[#625b6e]">
            Some older activity is not linked to a post and appears only in this view.
          </p>
        )}
      {state.status === 'ready' && state.executions.length > 0 && (
        <ul className="mt-6 grid gap-3" aria-label="Recent automation activity">
          {state.executions.map((execution) => (
            <li
              key={`${execution.createdAt}-${execution.commentText}`}
              className="rounded-xl border border-[var(--app-border)] bg-[#faf9f6] p-4"
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <p className="font-semibold break-words text-[#292638]">
                    {execution.commenterUsername
                      ? `@${execution.commenterUsername}`
                      : 'Instagram user'}
                  </p>
                  {execution.commenterUsername && (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <button
                        className="ui-button-secondary w-full sm:w-auto"
                        type="button"
                        onClick={() => void copyUsername(execution.commenterUsername!)}
                      >
                        {copiedUsername === execution.commenterUsername
                          ? 'Username copied'
                          : 'Copy username'}
                      </button>
                      <a
                        className="ui-button-secondary w-full sm:w-auto"
                        href={`https://www.instagram.com/${encodeURIComponent(execution.commenterUsername)}/`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open Instagram profile
                      </a>
                    </div>
                  )}
                </div>
                <time className="text-sm text-[#625b6e]" dateTime={execution.createdAt}>
                  {formatTimestamp(execution.createdAt)}
                </time>
              </div>
              <div className="mt-3 min-w-0">
                <p className="mt-1 break-words text-[#433d50]">{execution.commentText}</p>
                <ul className="mt-3 grid gap-2" aria-label="Delivery results">
                  {execution.deliveries.map((delivery) => (
                    <li
                      className="flex flex-col gap-2 rounded-lg bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center"
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
