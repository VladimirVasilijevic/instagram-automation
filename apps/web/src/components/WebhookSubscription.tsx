import { useState } from 'react';

import { subscribeToCommentDelivery } from '../api/webhook.js';

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
    <section className="ui-card p-5 sm:p-6" aria-live="polite" aria-labelledby="delivery-heading">
      <p className="text-xs font-semibold tracking-wide text-[#5632a8] uppercase">Delivery</p>
      <h2 id="delivery-heading" className="mt-1 text-xl font-semibold text-[#292638]">
        Enable comment delivery
      </h2>
      <p className="mt-2 leading-6 text-[#625b6e]">
        Enable Meta comment events after the webhook callback has been verified in Meta.
      </p>
      {status === 'enabled' && (
        <p role="status" className="ui-alert ui-alert-success mt-4">
          Comment delivery is enabled. New comments can reach your automation.
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="ui-alert ui-alert-error mt-4">
          Comment delivery could not be enabled. Please try again.
        </p>
      )}
      <button
        className="ui-button mt-5 w-full sm:w-auto"
        disabled={status === 'subscribing' || status === 'enabled'}
        onClick={() => void subscribe()}
      >
        {status === 'subscribing' ? 'Enabling…' : 'Enable comment delivery'}
      </button>
    </section>
  );
};
