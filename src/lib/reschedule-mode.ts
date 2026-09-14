/** Only server-persisted proposals contain this marker; older pending requests
 * retain their original accept-before-moving behavior. */
export function isImmediateReschedule(fingerprint: string | null | undefined): boolean {
  try {
    return JSON.parse(fingerprint ?? "null")?.applicationMode === "IMMEDIATE";
  } catch {
    return false;
  }
}
