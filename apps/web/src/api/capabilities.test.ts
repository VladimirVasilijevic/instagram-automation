import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCapabilities } from './capabilities.js';

afterEach(() => vi.unstubAllGlobals());

describe('public capabilities', () => {
  it('reads the Facebook login flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ facebookLoginEnabled: true }) }),
    );
    await expect(getCapabilities()).resolves.toEqual({ facebookLoginEnabled: true });
  });

  it('hides optional login when the endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(getCapabilities()).resolves.toEqual({ facebookLoginEnabled: false });
  });
});
