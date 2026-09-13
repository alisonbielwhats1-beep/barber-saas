import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { billingConfig } from "./config";
import { BillingError } from "./catalog";

const id = z.union([z.string(), z.number().int().safe()]).transform(String);
const date = z.string().datetime({ offset: true });
export const subscriptionSchema = z.object({
  id, collector_id: id, external_reference: z.string(), status: z.enum(["pending", "authorized", "paused", "cancelled", "canceled"]),
  init_point: z.string().url().optional(), payer_id: id.optional(), last_modified: date,
  next_payment_date: date.nullable().optional(),
  auto_recurring: z.object({ frequency: z.number().int(), frequency_type: z.string(), currency_id: z.string(), transaction_amount: z.coerce.number() }),
});
export const invoiceSchema = z.object({ id, preapproval_id: id, debit_date: date,
  currency_id: z.string(), transaction_amount: z.coerce.number(), last_modified: date,
  payment: z.object({ id: id.nullable().optional(), status: z.string().nullable().optional() }).nullable().optional(),
});
export const paymentSchema = z.object({ id, collector_id: id, currency_id: z.string(), transaction_amount: z.number(),
  status: z.string(), date_last_updated: date, date_approved: date.nullable().optional(), live_mode: z.boolean(),
  external_reference: z.string().nullable().optional(),
  transaction_amount_refunded: z.number().optional(),
  payer: z.object({ id: id.nullable().optional() }).optional(),
});
export type RemoteSubscription = z.infer<typeof subscriptionSchema>;
export type RemoteInvoice = z.infer<typeof invoiceSchema>;
export type RemotePayment = z.infer<typeof paymentSchema>;

export async function mpRequest(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const config = billingConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.mercadopago.com${path}`, {
      method, headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(6000), cache: "no-store", redirect: "error",
    });
  } catch { throw new BillingError("PROVIDER_UNAVAILABLE", 503); }
  // Do not expose provider bodies: they may include payer data or credential diagnostics.
  if (!response.ok) throw new BillingError(response.status >= 500 || response.status === 429 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED", 503);
  try { return await response.json(); } catch { throw new BillingError("PROVIDER_INVALID_RESPONSE", 503); }
}
export function parseProvider<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BillingError("PROVIDER_INVALID_RESPONSE", 503);
  return result.data;
}
export async function verifySellerAccount() {
  const config = billingConfig();
  const account = parseProvider(z.object({ id, site_id: z.string(), tags: z.array(z.string()) }), await mpRequest("/users/me"));
  if (account.id !== config.collectorId || account.site_id !== "MLB" || account.tags.includes("test_user") !== (config.mode === "test")) {
    throw new BillingError("SELLER_ACCOUNT_MISMATCH", 503);
  }
}
const safeId = (value: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new BillingError("INVALID_RESOURCE", 400);
  return encodeURIComponent(value);
};
export const getSubscription = async (value: string) => parseProvider(subscriptionSchema, await mpRequest(`/preapproval/${safeId(value)}`));
export const getInvoice = async (value: string) => parseProvider(invoiceSchema, await mpRequest(`/authorized_payments/${safeId(value)}`));
export const getPayment = async (value: string) => parseProvider(paymentSchema, await mpRequest(`/v1/payments/${safeId(value)}`));
export async function searchSubscriptions(reference: string) {
  return parseProvider(z.object({ results: z.array(subscriptionSchema) }), await mpRequest(`/preapproval/search?external_reference=${encodeURIComponent(reference)}`)).results.filter(s => s.external_reference === reference);
}
export async function listInvoices(subscriptionId: string, offset = 0) {
  // Use the provider's default page size; explicit limits are rejected by this API.
  return parseProvider(z.object({ results: z.array(invoiceSchema), paging: z.object({ total: z.number().int() }) }), await mpRequest(`/authorized_payments/search?preapproval_id=${safeId(subscriptionId)}&offset=${offset}`));
}
export function checkoutUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.mercadopago.com.br" || url.username || url.password || url.port) throw new BillingError("INVALID_CHECKOUT", 503);
  return url.toString();
}
export function verifyWebhook(headers: Headers, resourceId: string, secret: string) {
  const requestId = headers.get("x-request-id");
  const signature = headers.get("x-signature") ?? "";
  const ts = /(?:^|,)\s*ts=(\d+)(?:,|$)/.exec(signature)?.[1];
  const v1 = /(?:^|,)\s*v1=([a-fA-F0-9]{64})(?:,|$)/.exec(signature)?.[1];
  if (!requestId || requestId.length > 200 || !ts || !v1) throw new BillingError("INVALID_SIGNATURE", 401);
  // Replays are deduplicated durably. Do not reject legitimate delayed provider retries by age.
  const expected = createHmac("sha256", secret).update(`id:${resourceId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest();
  if (!timingSafeEqual(expected, Buffer.from(v1, "hex"))) throw new BillingError("INVALID_SIGNATURE", 401);
}
