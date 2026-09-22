import { useState } from 'react';

import { subscribeToCommentDelivery } from '../api/webhook.js';

const buttonStyle =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

/** Lets an authenticated owner enable Meta comment delivery after webhook verification is configured. */
export const WebhookSubscription = () => {
  const [status, setStatus] = useState<'idle' | 'enabled' | 'error' | 'subscribing'>('idle');

  const subscribe = async () => {
    setStatus('subscribing');
    try {
      await subscribeToCommentDelivery();
      setStatus('enabled');
    } catch {
      setStatus('error');
    }
  };

  return (
    <section className="mt-8 border-t border-slate-200 pt-8" aria-live="polite">
      <h3 className="text-xl font-semibold text-slate-950">Enable comment delivery</h3>
      <p className="mt-2 leading-7 text-slate-600">
        Enable Meta comment events after the webhook callback has been verified in Meta.
      </p>
      {status === 'enabled' && (
        <p role="status" className="mt-4 text-sm text-emerald-800">
          Comment delivery is enabled. Public replies are added in the next milestone.
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="mt-4 text-sm text-red-800">
          Comment delivery could not be enabled. Please try again.
        </p>
      )}
      <button
        className={`${buttonStyle} mt-5`}
        disabled={status === 'subscribing' || status === 'enabled'}
        onClick={() => void subscribe()}
      >
        {status === 'subscribing' ? 'Enabling…' : 'Enable comment delivery'}
      </button>
    </section>
  );
};
