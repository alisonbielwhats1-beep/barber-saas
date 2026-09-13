import "server-only";
import { syncBillingToHq } from "./hq-sync";
import { createHash } from "node:crypto";
import { withSalon, type Tx } from "../prisma-tenant";
import { BillingError } from "./catalog";
import { billingConfig } from "./config";
import * as mp from "./provider";
import { applyInvoice, applyRemoteSubscription, enqueue, ensureCreated, parseReference, validateRemote, subscriptionLock } from "./service";
import { changesEnabled } from "./change-terms";
import { parseUpgradeReference } from "./change-provider";
import { applyUpgradePayment } from "./change-payments";
import { syncPlanChanges } from "./change-worker";

/** The only global scope is dispatch metadata, not subscriptions, payments or tenant records. */
async function queueScope<T>(fn: (tx: Tx) => Promise<T>) {
  return withSalon("__billing_dispatch__", async tx => {
    await tx.$executeRaw`SELECT set_config('app.billing_dispatch', 'enabled', true)`;
    return fn(tx);
  });
}

export async function receiveWebhook(topic: string, resourceId: string, notificationKey: string) {
  billingConfig();
  let remote: mp.RemoteSubscription;
  if (topic === "subscription_preapproval") remote = await mp.getSubscription(resourceId);
  else if (topic === "subscription_authorized_payment") remote = await mp.getSubscription((await mp.getInvoice(resourceId)).preapproval_id);
  else if (topic === "payment") {
    const payment = await mp.getPayment(resourceId);
    if (payment.external_reference?.startsWith("efu:") && changesEnabled()) {
      const ref = parseUpgradeReference(payment.external_reference);
      await withSalon(ref.salonId, async tx => {
        await subscriptionLock(tx, ref.salonId);
        const change = await tx.billingPlanChange.findFirst({ where: { id: ref.id, salonId: ref.salonId }, include: { subscription: true } });
        if (!change || payment.collector_id !== change.subscription.collectorId) throw new BillingError("UNKNOWN_CHANGE", 404);
        const key = createHash("sha256").update(`${topic}:${resourceId}:${notificationKey}`).digest("hex");
        await tx.billingInbox.upsert({ where: { id: key }, update: {}, create: { id: key, salonId: ref.salonId, subscriptionId: change.subscriptionId, topic, resourceId } });
        await enqueue(tx, change.subscription);
      });
      return;
    }
    if (!payment.external_reference?.startsWith("ef:")) return;
    const ref = parseReference(payment.external_reference);
    const sub = await withSalon(ref.salonId, tx => tx.billingSubscription.findUnique({ where: { id: ref.id } }));
    if (!sub?.providerId) throw new BillingError("SUBSCRIPTION_NOT_READY", 503);
    remote = await mp.getSubscription(sub.providerId);
  } else throw new BillingError("UNSUPPORTED_TOPIC", 400);
  if (!remote.external_reference.startsWith("ef:")) return;
  const ref = parseReference(remote.external_reference);
  const sub = await withSalon(ref.salonId, tx => tx.billingSubscription.findUnique({ where: { id: ref.id } }));
  if (!sub) throw new BillingError("UNKNOWN_SUBSCRIPTION", 404);
  validateRemote(sub, remote, false);
  await applyRemoteSubscription(sub, remote);
  const key = createHash("sha256").update(`${topic}:${resourceId}:${notificationKey}`).digest("hex");
  await withSalon(ref.salonId, async tx => {
    await subscriptionLock(tx, ref.salonId);
    await tx.billingInbox.upsert({ where: { id: key }, update: {}, create: { id: key, salonId: ref.salonId, subscriptionId: ref.id, topic, resourceId } });
    await enqueue(tx, sub);
  });
}

export async function syncSubscription(salonId: string, id: string) {
  let sub = await withSalon(salonId, tx => tx.billingSubscription.findUniqueOrThrow({ where: { id } }));
  const wasUncreated = !sub.providerId;
  await ensureCreated(sub);
  sub = await withSalon(salonId, tx => tx.billingSubscription.findUniqueOrThrow({ where: { id } }));
  if (!sub.providerId) {
    if (sub.cancelledAt) return false;
    throw new BillingError("SUBSCRIPTION_NOT_READY", 503);
  }
  if (wasUncreated) return true;
  let remote = await mp.getSubscription(sub.providerId);
  validateRemote(sub, remote, false);
  const stopRenewal = async () => {
    if (!sub.cancelRequestedAt) return false;
    const needed = !["cancelled", "canceled"].includes(remote.status);
    // PUT is an idempotent target state; a lost response is resolved by GET on retry.
    if (needed) {
      await mp.mpRequest(`/preapproval/${encodeURIComponent(sub.providerId!)}`, "PUT", { status: "cancelled" });
      remote = await mp.getSubscription(sub.providerId!);
    }
    if (!["cancelled", "canceled"].includes(remote.status)) throw new BillingError("CANCELLATION_NOT_CONFIRMED", 503);
    await applyRemoteSubscription(sub, remote);
    return needed;
  };
  if (await stopRenewal()) return true;
  // Stopping charges takes priority over reconciliation of an unrelated plan change.
  await syncPlanChanges(sub);
  sub = await withSalon(salonId, tx => tx.billingSubscription.findUniqueOrThrow({ where: { id } }));
  if (!sub.providerId) throw new BillingError("SUBSCRIPTION_NOT_READY", 503);
  remote = await mp.getSubscription(sub.providerId!);
  if (await stopRenewal()) return true;
  await applyRemoteSubscription(sub, remote);
  const inbox = await withSalon(salonId, tx => tx.billingInbox.findMany({ where: { subscriptionId: id, processedAt: null }, orderBy: { receivedAt: "asc" }, take: 1 }));
  for (const item of inbox) {
    if (item.topic === "subscription_authorized_payment") {
      const invoice = await mp.getInvoice(item.resourceId);
      await applyInvoice(sub, remote, invoice, invoice.payment?.id ? await mp.getPayment(invoice.payment.id) : null);
    } else if (item.topic === "payment") {
      const payment = await mp.getPayment(item.resourceId);
      if (changesEnabled() && payment.external_reference?.startsWith("efu:")) {
        const ref = parseUpgradeReference(payment.external_reference);
        const change = await withSalon(salonId, tx => tx.billingPlanChange.findFirstOrThrow({ where: { id: ref.id, salonId, subscriptionId: id } }));
        await applyUpgradePayment(sub, change, remote, payment);
        await withSalon(salonId, async tx => { await subscriptionLock(tx, salonId); await tx.billingInbox.update({ where: { id: item.id }, data: { processedAt: new Date() } }); });
        return true;
      }
      const known = await withSalon(salonId, tx => tx.billingCharge.findFirst({ where: { subscriptionId: id, providerPaymentId: item.resourceId } }));
      if (known) {
        const invoice = await mp.getInvoice(known.providerInvoiceId);
        await applyInvoice(sub, remote, invoice, invoice.payment?.id ? await mp.getPayment(invoice.payment.id) : null);
      } else {
        // The periodic invoice search below resolves early payment notifications.
        continue;
      }
    }
    await withSalon(salonId, async tx => { await subscriptionLock(tx, salonId); return tx.billingInbox.update({ where: { id: item.id }, data: { processedAt: new Date() } }); });
    // One inbox resource OR one periodic invoice per call bounds provider latency.
    return true;
  }
  // A bounded page per invocation, with a durable cursor for long-lived annual/monthly contracts.
  const page = await mp.listInvoices(sub.providerId, sub.invoiceOffset);
  const invoices = page.results.slice(0, 1);
  for (const invoice of invoices) {
    await applyInvoice(sub, remote, invoice, invoice.payment?.id ? await mp.getPayment(invoice.payment.id) : null);
  }
  const nextOffset = sub.invoiceOffset + invoices.length;
  const more = invoices.length > 0 && nextOffset < page.paging.total;
  await withSalon(salonId, async tx => { await subscriptionLock(tx, salonId); return tx.billingSubscription.update({ where: { id }, data: { lastSyncedAt: new Date(), invoiceOffset: more ? nextOffset : 0 } }); });
  const pending = changesEnabled() ? await withSalon(salonId, tx => tx.billingPlanChange.findFirst({ where: { subscriptionId: id, salonId, state: { in: ["PREPARING", "AWAITING_PAYMENT", "APPLYING", "CANCEL_REQUESTED"] } }, select: { id: true } })) : null;
  return more || inbox.length === 1 || Boolean(pending);
}

export async function runBillingWorker(limit = 2) {
  billingConfig();
  const result = { processed: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const startedAt = new Date();
    const jobs = await queueScope(tx => tx.$queryRaw<Array<{ subscriptionId: string; salonId: string; leaseUntil: Date }>>`
      UPDATE "BillingQueue" SET "leaseUntil" = CURRENT_TIMESTAMP + interval '5 minutes'
      WHERE "subscriptionId" = (SELECT "subscriptionId" FROM "BillingQueue"
        WHERE "nextAttemptAt" <= CURRENT_TIMESTAMP AND ("leaseUntil" IS NULL OR "leaseUntil" < CURRENT_TIMESTAMP)
        ORDER BY "nextAttemptAt", "subscriptionId" LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING "subscriptionId", "salonId", "leaseUntil"
    `);
    const job = jobs[0];
    if (!job) break;
    let error: string | null = null;
    let more = false;
    try { more = await syncSubscription(job.salonId, job.subscriptionId); more = await syncBillingToHq(job.salonId, job.subscriptionId) || more; result.processed++; }
    catch (e) { error = e instanceof BillingError ? e.code : "PROCESSING_FAILED"; result.failed++; }
    await queueScope(async tx => {
      const current = await tx.billingQueue.findUniqueOrThrow({ where: { subscriptionId: job.subscriptionId } });
      const delay = error ? Math.min(3600000, 60000 * 2 ** Math.min(current.attempts, 6)) : more ? 1000 : 3600000;
      const receivedDuringRun = current.nextAttemptAt > startedAt;
      await tx.billingQueue.updateMany({ where: { subscriptionId: job.subscriptionId, leaseUntil: job.leaseUntil }, data: {
        leaseUntil: null, nextAttemptAt: receivedDuringRun ? current.nextAttemptAt : new Date(Date.now() + delay),
        attempts: error ? current.attempts + 1 : 0, lastError: error,
      } });
    });
  }
  return result;
}
