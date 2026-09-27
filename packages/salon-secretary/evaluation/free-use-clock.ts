/** Frozen-clock helper is evaluation-only and restored even after failure. */
export async function withFreeUseClock<T>(clock: string, task: () => Promise<T>): Promise<T> {
  const original = globalThis.Date, fixed = original.parse(clock);
  if (!Number.isFinite(fixed)) throw Error('FREE_USE_CLOCK_INVALID');
  const controlled = new Proxy(original, {
    construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [fixed], newTarget); },
    get(target, property, receiver) { return property === 'now' ? () => fixed : Reflect.get(target, property, receiver); },
  });
  globalThis.Date = controlled;
  try { return await task(); } finally { globalThis.Date = original; }
}
