import { withHq } from "@/lib/hq/access";
import { billingConfig } from "@/lib/billing/config";
import { billingFailure, billingJson } from "@/lib/billing/http";
import { accessState } from "@/lib/billing/catalog";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    billingConfig();
    const url = new URL(request.url);
    const cursor = z.string().uuid().nullable().parse(url.searchParams.get("cursor"));
    const result = await withHq(async tx => {
      const rows = await tx.billingSubscription.findMany({ where: { ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 51,
        select: { id: true, salonId: true, planCode: true, cycle: true, amountCents: true, agendaLimit: true, current: true,
          paidThrough: true, delinquentSince: true, cancelledAt: true, reviewRequired: true, providerStatus: true, lastSyncedAt: true,
          queue: { select: { attempts: true, lastError: true, nextAttemptAt: true } } } });
      return { source: "MERCADOPAGO", subscriptions: rows.slice(0, 50).map(s => ({ ...s, state: accessState(s) })), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
    return billingJson(result);
  } catch (e) { return billingFailure(e); }
}
