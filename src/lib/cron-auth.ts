import { timingSafeEqual } from "node:crypto";

export function isCronAuthorized(
  authorizationHeader: string | null,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret || !authorizationHeader) return false;

  const expected = Buffer.from(`Bearer ${configuredSecret}`);
  const received = Buffer.from(authorizationHeader);
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}
