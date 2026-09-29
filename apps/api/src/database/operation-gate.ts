/** Serializes asynchronous operations in first-in, first-out order. */
export interface AsyncOperationGate {
  /**
   * Waits for earlier operations, then runs the supplied operation exclusively.
   *
   * @param operation - Work that must not overlap other operations using this gate.
   * @returns The operation result.
   */
  run<T>(operation: () => PromiseLike<T> | T): Promise<T>;
}

/** Creates a first-in, first-out asynchronous operation gate. */
export const createAsyncOperationGate = (): AsyncOperationGate => {
  let tail = Promise.resolve();

  return {
    run<T>(operation: () => PromiseLike<T> | T): Promise<T> {
      const ready = tail;
      let release: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });

      return ready.then(operation).finally(() => release());
    },
  };
};

/**
 * Routes every method call on an object through a shared asynchronous operation gate.
 *
 * @param target - Object whose asynchronous methods must be serialized.
 * @param gate - Gate shared with every object using the same underlying resource.
 * @returns A proxy with the same public shape as the target.
 */
export const serializeAsyncMethods = <T extends object>(target: T, gate: AsyncOperationGate): T =>
  new Proxy(target, {
    get(currentTarget, property, receiver) {
      const value = Reflect.get(currentTarget, property, receiver);

      if (typeof value !== 'function') return value;

      return (...args: unknown[]) =>
        gate.run(() => Reflect.apply(value, currentTarget, args) as PromiseLike<unknown>);
    },
  });
