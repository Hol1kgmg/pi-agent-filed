/**
 * Runs async work one at a time, in call order. A Durable Object's input gate only covers storage
 * awaits; work that also awaits the harness has to be ordered here. Why not `blockConcurrencyWhile`:
 * it stops every other event on the object, resets the object after 30 s, and the platform rules
 * reserve it for one-time initialization.
 */
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => {});
    return run;
  };
}
