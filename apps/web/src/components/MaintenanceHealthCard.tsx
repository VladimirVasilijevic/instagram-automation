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
    style: 'ui-alert-success',
  },
  [MAINTENANCE_STATUS.ATTENTION]: {
    label: 'Maintenance needs attention',
    description: 'The latest run detected a failure or work that needs review.',
    style: 'ui-alert-warning',
  },
  [MAINTENANCE_STATUS.DELAYED]: {
    label: 'Maintenance delayed',
    description: 'No successful run was recorded during the last 45 minutes.',
    style: 'ui-alert-error',
  },
  [MAINTENANCE_STATUS.NEVER_RUN]: {
    label: 'Maintenance not observed',
    description: 'No completed scheduled-maintenance run has been recorded yet.',
    style: 'border-[var(--app-border)] bg-[#f5f2ed] text-[#433d50]',
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
      <section className="ui-card p-5 sm:p-6" aria-labelledby="maintenance-heading">
        <h2 id="maintenance-heading" className="text-xl font-semibold text-[#292638]">
          Scheduled maintenance
        </h2>
        <p role="status" className="mt-3 text-sm text-[#625b6e]">
          Checking scheduled maintenance…
        </p>
      </section>
    );
  if (state.status === 'error')
    return (
      <section className="ui-card p-5 sm:p-6" aria-labelledby="maintenance-heading">
        <h2 id="maintenance-heading" className="text-xl font-semibold text-[#292638]">
          Scheduled maintenance
        </h2>
        <p role="alert" className="ui-alert ui-alert-error mt-3">
          Maintenance health could not be loaded.
        </p>
        <button
          className="ui-button-secondary mt-3"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </button>
      </section>
    );

  const view = presentation[state.health.status];
  return (
    <section
      className="ui-card p-5 sm:p-6"
      aria-live="polite"
      aria-labelledby="maintenance-heading"
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-[#5632a8] uppercase">
            Service health
          </p>
          <h2 id="maintenance-heading" className="mt-1 text-xl font-semibold text-[#292638]">
            Scheduled maintenance
          </h2>
          <div className={`mt-4 rounded-xl border p-4 ${view.style}`}>
            <h3 className="font-semibold">{view.label}</h3>
            <p className="mt-1 text-sm leading-6">{view.description}</p>
            {state.health.lastSucceededAt && (
              <p className="mt-1 text-sm">
                Last completed {formatTimestamp(state.health.lastSucceededAt)}
              </p>
            )}
          </div>
        </div>
        <button
          className="ui-button-secondary shrink-0"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
    </section>
  );
};
