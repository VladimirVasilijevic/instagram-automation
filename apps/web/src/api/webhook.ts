const request = async (): Promise<Response> => {
  try {
    return await fetch('/api/webhooks/instagram/subscription', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error('Comment delivery could not be enabled. Please try again.', { cause: error });
  }
};

/** Requests an idempotent Meta comments subscription for the signed-in Instagram account. */
export const subscribeToCommentDelivery = async (): Promise<void> => {
  const response = await request();
  if (response.status !== 204)
    throw new Error('Comment delivery could not be enabled. Please try again.');
};
