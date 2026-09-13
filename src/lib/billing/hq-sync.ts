import "server-only";
import { withSalon } from "@/lib/prisma-tenant";
import { dateKeyInTimeZone } from "@/lib/time";
import { accessState, BILLING_PLANS, BillingError } from "./catalog";
import { subscriptionLock } from "./service";
import { billingConfig } from "./config";

const accountingDate = (date: Date) => new Date(`${dateKeyInTimeZone(date, "America/Sao_Paulo")}T00:00:00.000Z`);
const accessLabels: Record<string, string> = { ACTIVE: "Plano ativo", VERIFYING: "Conferindo renovação", GRACE: "Atraso em carência", RESTRICTED: "Regularização necessária", EXPIRED: "Período encerrado", UNPAID: "Aguardando pagamento" };

/** Bounded, replayable projection. Billing remains the financial source of truth. */
export async function syncBillingToHq(salonId: string, id: string): Promise<boolean> {
  if (process.env.MERCADOPAGO_HQ_SYNC_ENABLED !== "true") return false;
  const config = billingConfig();
  return withSalon(salonId, async tx => {
    await subscriptionLock(tx, salonId);
    const sub = await tx.billingSubscription.findFirstOrThrow({ where: { id, salonId } });
    if (sub.mode !== config.mode || sub.collectorId !== config.collectorId) throw new BillingError("BILLING_ENVIRONMENT_MISMATCH", 503);
    // A checkout authorization or rejected first charge never becomes a paying CRM customer.
    if (!sub.paidThrough) return false;
    await tx.$executeRaw`SELECT set_config('app.billing_hq_sync', 'enabled', true)`;
    const salon = await tx.salon.findUniqueOrThrow({ where: { id: salonId }, select: { name: true, phone: true, segment: true } });
    const owner = await tx.membership.findFirst({ where: { salonId, role: "OWNER" }, select: { user: { select: { name: true, email: true } } }, orderBy: { userId: "asc" } });
    const account = await tx.hqAccounts.upsert({ where: { billingSalonId: salonId }, update: {}, create: {
      billingSalonId: salonId, name: owner?.user.name || salon.name, business: salon.name, email: owner?.user.email ?? sub.payerEmail,
      phone: salon.phone, segment: salon.segment, source: config.mode === "test" ? "Mercado Pago · teste" : "Mercado Pago",
    } });
    const state = accessState(sub);
    const subscriptionStatus = sub.cancelledAt ? "Cancelado" : sub.providerStatus === "paused" ? "Pausado" : ["GRACE", "RESTRICTED"].includes(state) ? "Inadimplente" : "Ativo";
    const billingState = sub.cancelledAt ? (state === "ACTIVE" ? "Cancelada · acesso até o fim pago" : "Cancelada · período encerrado")
      : sub.cancelRequestedAt ? "Cancelamento em confirmação" : sub.reviewRequired ? "Revisão financeira" : accessLabels[state];
    const customerStatus = state === "EXPIRED" ? "Cancelado" : ["GRACE", "RESTRICTED"].includes(state) ? "Inadimplente" : "Ativo";
    const customer = await tx.hqCustomers.upsert({ where: { accountId: account.id },
      create: { accountId: account.id, status: customerStatus, startedAt: accountingDate(sub.createdAt), paymentMethod: "Mercado Pago" },
      // Historical contracts must not overwrite the current customer's situation.
      update: sub.current ? { status: customerStatus, paymentMethod: "Mercado Pago" } : {},
    });
    const previous = await tx.hqSubscriptions.findUnique({ where: { billingSubscriptionId: id } });
    const values = { plan: BILLING_PLANS[sub.planCode as keyof typeof BILLING_PLANS].label,
      amountCents: sub.amountCents, discountCents: 0, interval: sub.intervalMonths === 12 ? "Anual" : "Mensal",
      startedAt: accountingDate(sub.createdAt), nextBillingAt: accountingDate(sub.nextPaymentAt ?? sub.paidThrough),
      status: subscriptionStatus, cancelledAt: sub.cancelledAt, provider: config.mode === "test" ? "Mercado Pago · teste" : "Mercado Pago",
      externalId: sub.providerId, billingState, billingPaidThrough: sub.paidThrough, billingAgendaLimit: sub.agendaLimit,
    };
    const hqSub = await tx.hqSubscriptions.upsert({ where: { billingSubscriptionId: id },
      create: { billingSubscriptionId: id, customerId: customer.id, ...values }, update: values,
    });
    if (!previous || previous.billingState !== billingState) await tx.hqActivities.create({ data: {
      accountId: account.id, kind: "Mudança de status", description: `Assinatura ${values.plan}: ${billingState}.`,
      entityType: "subscriptions", entityId: hqSub.id, metadata: { source: "mercadopago", subscriptionId: id, previous: previous?.billingState ?? null, current: billingState },
    } });
    const pendingCharges = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM "BillingCharge" c LEFT JOIN hq_payments h ON h."billingChargeId"=c.id
      WHERE c."salonId"=${salonId} AND c."subscriptionId"=${id}::uuid
        AND (h.id IS NULL OR h."billingUpdatedAt" IS NULL OR h."billingUpdatedAt" < c."providerUpdatedAt" OR h."billingStatus" IS DISTINCT FROM c.status)
      ORDER BY c."providerUpdatedAt", c.id LIMIT 11`;
    for (const row of pendingCharges.slice(0, 10)) {
      const charge = await tx.billingCharge.findUniqueOrThrow({ where: { id: row.id } });
      const paid = (charge.status === "approved" || (charge.status === "refunded" && charge.refundedCents > 0 && charge.refundedCents < charge.amountCents)) && charge.paidAt !== null;
      const cancelled = ["cancelled", "refunded", "charged_back"].includes(charge.status);
      const data = { subscriptionId: hqSub.id, reference: accountingDate(charge.periodStart), dueDate: accountingDate(charge.periodStart), amountCents: charge.amountCents,
        status: paid ? "Pago" : cancelled ? "Cancelado" : "Pendente", paidDate: paid ? accountingDate(charge.paidAt!) : null,
        method: "Mercado Pago", externalId: charge.providerPaymentId ?? charge.providerInvoiceId,
        billingUpdatedAt: charge.providerUpdatedAt, billingStatus: charge.status, billingRefundedCents: charge.refundedCents,
        notes: `Sincronizado com Mercado Pago. Fatura ${charge.providerInvoiceId}. Situação: ${charge.status}.`,
      };
      await tx.hqPayments.upsert({ where: { billingChargeId: charge.id }, create: { billingChargeId: charge.id, ...data }, update: data });
    }
    const pendingEvents = await tx.billingEvent.findMany({ where: { subscriptionId: id, salonId, hqActivity: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 11 });
    for (const event of pendingEvents.slice(0, 10)) await tx.hqActivities.create({ data: {
      accountId: account.id, billingEventId: event.id, kind: event.type === "PAYMENT_UPDATED" ? "Pagamento" : "Mudança de status",
      description: event.type === "PAYMENT_UPDATED" ? "Cobrança atualizada automaticamente pelo Mercado Pago." : "Assinatura atualizada automaticamente pelo Mercado Pago.",
      entityType: "subscriptions", entityId: hqSub.id,
      metadata: { source: "mercadopago", subscriptionId: id, eventType: event.type, detail: event.detail, occurredAt: event.createdAt.toISOString() },
    } });
    return pendingCharges.length > 10 || pendingEvents.length > 10;
  });
}
