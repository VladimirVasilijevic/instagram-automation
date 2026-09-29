import { describe, expect, it, vi } from 'vitest';

import { createAsyncOperationGate, serializeAsyncMethods } from './operation-gate.js';

const deferred = <T>() => {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject: (reason?: unknown) => reject(reason),
    resolve: (value: T) => resolve(value),
  };
};

describe('asynchronous operation gate', () => {
  it('runs operations one at a time in first-in, first-out order', async () => {
    const gate = createAsyncOperationGate();
    const firstRelease = deferred<string>();
    const secondRelease = deferred<string>();
    const events: string[] = [];
    let activeCount = 0;
    let maximumActiveCount = 0;
    const operation = (name: string, release: Promise<string>) =>
      gate.run(async () => {
        events.push(`start:${name}`);
        activeCount += 1;
        maximumActiveCount = Math.max(maximumActiveCount, activeCount);
        const result = await release;
        activeCount -= 1;
        events.push(`finish:${name}`);
        return result;
      });

    const first = operation('first', firstRelease.promise);
    const second = operation('second', secondRelease.promise);
    await Promise.resolve();

    expect(events).toEqual(['start:first']);
    firstRelease.resolve('first result');
    await first;
    expect(events).toEqual(['start:first', 'finish:first', 'start:second']);
    secondRelease.resolve('second result');

    await expect(second).resolves.toBe('second result');
    expect(maximumActiveCount).toBe(1);
  });

  it('releases the next operation after rejection or a synchronous throw', async () => {
    const gate = createAsyncOperationGate();
    const rejected = gate.run(() => Promise.reject(new Error('async failure')));
    const thrown = gate.run(() => {
      throw new Error('sync failure');
    });
    const completed = gate.run(() => 'completed');

    await expect(rejected).rejects.toThrow('async failure');
    await expect(thrown).rejects.toThrow('sync failure');
    await expect(completed).resolves.toBe('completed');
  });

  it('serializes separate repository objects sharing one gate', async () => {
    const gate = createAsyncOperationGate();
    const firstRelease = deferred<string>();
    const firstMethod = vi.fn(() => firstRelease.promise);
    const secondMethod = vi.fn(async (value: string) => `saved:${value}`);
    const firstRepository = serializeAsyncMethods({ find: firstMethod }, gate);
    const secondRepository = serializeAsyncMethods({ save: secondMethod }, gate);

    const first = firstRepository.find();
    const second = secondRepository.save('value');
    await Promise.resolve();

    expect(firstMethod).toHaveBeenCalledOnce();
    expect(secondMethod).not.toHaveBeenCalled();
    firstRelease.resolve('found');

    await expect(first).resolves.toBe('found');
    await expect(second).resolves.toBe('saved:value');
    expect(secondMethod).toHaveBeenCalledWith('value');
  });
});
