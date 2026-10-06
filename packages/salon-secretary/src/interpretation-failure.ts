/** B5: an error raised while READING the model's answer (its validation and decoding, the checks of the
 * single literal repair, a missing tool call). Nothing of that message was applied, so an active plan is
 * kept. The error is tagged by identity: its class, message and code stay exactly the historical ones.
 * Transport, timeout, budget, cost-guard and audit failures are never tagged. */
const failures = new WeakSet<object>();
export function markInterpretationFailure<T>(error: T): T {
  if (error !== null && typeof error === "object") failures.add(error);
  return error;
}
export const isInterpretationFailure = (error: unknown) => error !== null && typeof error === "object" && failures.has(error);
