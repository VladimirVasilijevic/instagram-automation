import { useEffect, useState } from 'react';
import { MAINTENANCE_STATUS } from '@instagram-automation/contracts';

import { getMaintenanceHealth, type MaintenanceHealth } from '../api/maintenance-health.js';

type HealthState =
  { status: 'loading' } | { status: 'ready'; health: MaintenanceHealth } | { status: 'error' };

const presentation: Record<
  MaintenanceHealth['status'],
  { label: string; description: string; style: string }
> = {
  [MAINTENANCE_STATUS.HEALTHY]: {
    label: 'Maintenance healthy',
    description: 'Scheduled token and reply recovery is completing normally.',
    style: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  },
  [MAINTENANCE_STATUS.ATTENTION]: {
    label: 'Maintenance needs attention',
    description: 'The latest run detected a failure or work that needs review.',
    style: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  [MAINTENANCE_STATUS.DELAYED]: {
    label: 'Maintenance delayed',
    description: 'No successful run was recorded during the last 45 minutes.',
    style: 'border-red-200 bg-red-50 text-red-950',
  },
  [MAINTENANCE_STATUS.NEVER_RUN]: {
    label: 'Maintenance not observed',
    description: 'No completed scheduled-maintenance run has been recorded yet.',
    style: 'border-slate-200 bg-slate-50 text-slate-800',
  },
};

const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );

/** Displays durable scheduled-maintenance health to the authenticated account owner. */
export const MaintenanceHealthCard = () => {
  const [state, setState] = useState<HealthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void getMaintenanceHealth(controller.signal)
      .then((health) => {
        if (!controller.signal.aborted) setState({ status: 'ready', health });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  if (state.status === 'loading')
    return (
      <p role="status" className="mt-6 text-sm text-slate-600">
        Checking scheduled maintenance…
      </p>
    );
  if (state.status === 'error')
    return (
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p role="alert" className="text-sm text-slate-700">
          Maintenance health could not be loaded.
        </p>
        <button
          className="mt-3 text-sm font-semibold underline underline-offset-4"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );

  const view = presentation[state.health.status];
  return (
    <section className={`mt-6 rounded-xl border p-4 ${view.style}`} aria-live="polite">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="font-semibold">{view.label}</h3>
          <p className="mt-1 text-sm leading-6">{view.description}</p>
          {state.health.lastSucceededAt && (
            <p className="mt-1 text-sm">
              Last completed {formatTimestamp(state.health.lastSucceededAt)}
            </p>
          )}
        </div>
        <button
          className="text-sm font-semibold underline underline-offset-4"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
    </section>
  );
};
