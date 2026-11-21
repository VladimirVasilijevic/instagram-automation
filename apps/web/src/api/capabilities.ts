/** Public provider availability. An unavailable endpoint leaves optional login hidden. */
export const getCapabilities = async (signal?: AbortSignal) => {
  try {
    const response = await fetch('/api/capabilities', { signal });
    if (!response.ok) return { facebookLoginEnabled: false };
    const body: unknown = await response.json();
    return {
      facebookLoginEnabled:
        typeof body === 'object' &&
        body !== null &&
        'facebookLoginEnabled' in body &&
        body.facebookLoginEnabled === true,
    };
  } catch {
    return { facebookLoginEnabled: false };
  }
};
