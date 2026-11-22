import { describe, expect, it } from 'vitest';

import { settleThenCleanup } from './lifecycle.js';

describe('load fixture lifecycle', () => {
  it('does not clean up while a peer worker still runs after another worker fails', async () => {
    const events: string[] = [];
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const task = settleThenCleanup(
      [Promise.reject(new Error('worker failed')), pending],
      async () => {
        events.push('cleanup');
      },
    );
    await Promise.resolve();
    expect(events).toEqual([]);
    events.push('last worker finished');
    finish();
    await task;
    expect(events).toEqual(['last worker finished', 'cleanup']);
  });
});
