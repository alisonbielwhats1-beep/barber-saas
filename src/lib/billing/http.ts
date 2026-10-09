import "server-only";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { authOptions } from "../auth";
import { BillingError } from "./catalog";
import { billingConfig } from "./config";
import { checkRateLimit } from "../rate-limit";

export async function ownerContext(request: Request, mutation = false) {
  const config = billingConfig();
  if (mutation && request.headers.get("origin") !== config.baseUrl) throw new BillingError("INVALID_ORIGIN", 403);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new BillingError("UNAUTHORIZED", 401);
  const limit = await checkRateLimit({ namespace: mutation ? "billing-write" : "billing-read", identifier: session.user.id,
    limit: mutation ? 15 : 120, windowSeconds: 60, failClosed: true });
  if (!limit.allowed) throw new BillingError("RATE_LIMITED", limit.source === "unavailable" ? 503 : 429);
  const salonId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(new URL(request.url).searchParams.get("salonId"));
  return { userId: session.user.id, salonId };
}
/** The exact body as text, under a streaming byte cap (also without Content-Length). Stripe signs these exact bytes. */
export async function readBillingText(request: Request, limit = 4096) {
  const reader = request.body?.getReader();
  if (!reader) throw new BillingError("INVALID_BODY", 400);
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new BillingError("BODY_TOO_LARGE", 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function readBillingBody(request: Request) {
  const text = await readBillingText(request);
  try { return JSON.parse(text) as unknown; }
  catch { throw new BillingError("INVALID_JSON", 400); }
}
export const billingJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function billingFailure(error: unknown) {
  unstable_rethrow(error);
  return billingJson({ error: error instanceof BillingError ? error.code : error instanceof z.ZodError ? "INVALID_REQUEST" : "BILLING_UNAVAILABLE" },
    error instanceof BillingError ? error.status : error instanceof z.ZodError ? 400 : 503);
}
