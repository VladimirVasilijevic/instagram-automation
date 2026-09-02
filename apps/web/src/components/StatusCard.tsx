/** Visual states supported by an infrastructure status card. */
export type StatusCardState = 'connected' | 'loading' | 'unavailable';

/** Properties accepted by the reusable status-card component. */
export interface StatusCardProps {
  /** Short explanation displayed below the current state. */
  description: string;

  /** Current service state. */
  state: StatusCardState;

  /** Service name displayed as the card heading. */
  title: string;
}

const statePresentation: Record<
  StatusCardState,
  { badgeClassName: string; dotClassName: string; label: string }
> = {
  connected: {
    badgeClassName: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    dotClassName: 'bg-emerald-500',
    label: 'Connected',
  },
  loading: {
    badgeClassName: 'bg-amber-50 text-amber-800 ring-amber-200',
    dotClassName: 'animate-pulse bg-amber-500 motion-reduce:animate-none',
    label: 'Checking',
  },
  unavailable: {
    badgeClassName: 'bg-rose-50 text-rose-800 ring-rose-200',
    dotClassName: 'bg-rose-500',
    label: 'Unavailable',
  },
};

/**
 * Displays the current state of one infrastructure service.
 *
 * @param props - Service title, state, and supporting description.
 * @returns An accessible status section that does not rely on color alone.
 */
export const StatusCard = ({ description, state, title }: StatusCardProps) => {
  const presentation = statePresentation[state];

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <div
          className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${presentation.badgeClassName}`}
        >
          <span className={`size-2 rounded-full ${presentation.dotClassName}`} aria-hidden="true" />
          <span>{presentation.label}</span>
        </div>
      </div>
    </section>
  );
};
