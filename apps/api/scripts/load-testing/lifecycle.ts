/** Waits for every worker, including peers of a rejected worker, before fixture cleanup. */
export const settleThenCleanup = async (
  work: Iterable<Promise<unknown>>,
  cleanup: () => Promise<void>,
): Promise<void> => {
  await Promise.allSettled([...work]);
  await cleanup();
};
