import { z } from "zod";
import type { Tx } from "@/lib/prisma-tenant";
import { definition, type Row, stages } from "./catalog";
import { HqError, normalizedTitle, parseValues, today, uuid } from "./validation";
import * as repo from "./repository";

export type Command =
 | { type: "save"; entity: string; id?: string; values: unknown; account?: unknown }
 | { type: "convert"; id: string }
 | { type: "move"; id: string; stage: string }
 | { type: "pay"; id: string; paidDate: string; method: string }
 | { type: "feedback"; id: string; target: "tickets" | "bugs" | "features"; existingId?: string };

async function accountFor(tx: Tx, entity: string, row: Row): Promise<string | null> {
  if (entity === "accounts") return row.id;
  if (row.accountId) return String(row.accountId);
  if (row.customerId) return String((await repo.find(tx, "customers", String(row.customerId))).accountId);
  if (row.subscriptionId) return accountFor(tx, "subscriptions", await repo.find(tx, "subscriptions", String(row.subscriptionId)));
  return null;
}
async function activity(tx: Tx, actorId: string, accountId: string | null, kind: string, description: string, entityType: string, entityId: string, metadata: unknown = {}) {
  return repo.insert(tx, "activities", { accountId, kind, description, actorId, entityType, entityId, metadata: JSON.stringify(metadata) });
}
async function checkRelations(tx: Tx, entity: string, values: Record<string, unknown>) {
  for (const field of definition(entity).fields) {
    if (field.ref && values[field.key]) await repo.find(tx, field.ref, String(values[field.key]));
  }
}
async function convertedCustomer(tx: Tx, actorId: string, leadId: string) {
  const lead = await repo.find(tx, "leads", leadId, true);
  const existing = await repo.related(tx, "customers", "accountId", String(lead.accountId));
  if (existing[0]) return existing[0];
  const customer = await repo.insert(tx, "customers", {
    accountId: lead.accountId, status: "Teste", startedAt: today(), satisfaction: "Não avaliada",
  });
  await repo.update(tx, "leads", leadId, { status: "Convertido" });
  const opportunities = await repo.related(tx, "opportunities", "accountId", String(lead.accountId));
  for (const op of opportunities) if (op.stage !== "Perdido") await repo.update(tx, "opportunities", op.id, { stage: "Fechado", probability: 100, stageChangedAt: new Date().toISOString() });
  await activity(tx, actorId, String(lead.accountId), "Mudança de status", "Lead convertido em cliente. Histórico preservado.", "customers", customer.id);
  return customer;
}

export async function execute(tx: Tx, actorId: string, command: Command): Promise<Row> {
  if (command.type === "convert") return convertedCustomer(tx, actorId, uuid.parse(command.id));
  if (command.type === "move") {
    const stage = z.enum(stages).parse(command.stage);
    const op = await repo.find(tx, "opportunities", command.id, true);
    if (op.stage === stage) return op;
    const updated = await repo.update(tx, "opportunities", op.id, { stage, stageChangedAt: new Date().toISOString(), ...(stage === "Fechado" ? { probability: 100 } : {}) });
    await activity(tx, actorId, String(op.accountId), "Mudança de status", `Oportunidade: ${op.stage} → ${stage}`, "opportunities", op.id);
    return updated;
  }
  if (command.type === "pay") {
    const paidDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v && v <= today(), "Data de pagamento inválida.").parse(command.paidDate);
    const method = z.string().trim().min(1).max(100).parse(command.method);
    const payment = await repo.find(tx, "payments", command.id, true);
    if (payment.status === "Pago") return payment;
    if (payment.status !== "Pendente") throw new HqError("Pagamento cancelado não pode ser confirmado.");
    const updated = await repo.update(tx, "payments", payment.id, { status: "Pago", paidDate, method });
    await activity(tx, actorId, await accountFor(tx, "payments", payment), "Pagamento", "Pagamento confirmado manualmente.", "payments", payment.id, { amountCents: payment.amountCents, paidDate, method });
    return updated;
  }
  if (command.type === "feedback") {
    const feedback = await repo.find(tx, "feedbacks", command.id, true);
    const target = z.enum(["tickets", "bugs", "features"]).parse(command.target);
    const fk = target === "tickets" ? "ticketId" : target === "bugs" ? "bugId" : "featureId";
    if (feedback[fk]) return repo.find(tx, target, String(feedback[fk]));
    if (!command.existingId && target !== "tickets") throw new HqError("Crie ou escolha um item de produto após revisar os similares.");
    const record = command.existingId
      ? await repo.find(tx, target, command.existingId)
      : await repo.insert(tx, "tickets", { customerId: feedback.customerId, title: String(feedback.description).slice(0, 100), description: feedback.description, category: "Suporte", priority: "Média", status: "Aberto" });
    if (target === "tickets" && record.customerId !== feedback.customerId) throw new HqError("O ticket pertence a outro cliente.");
    if (target !== "tickets") {
      const entity = target === "bugs" ? "bugCustomers" : "featureCustomers";
      const key = target === "bugs" ? "bugId" : "featureId";
      // Serializa associação/replay para o mesmo produto e cliente.
      await repo.find(tx, target, record.id, true);
      const links = await repo.related(tx, entity, key, record.id);
      if (!links.some(link => link.customerId === feedback.customerId)) await repo.insert(tx, entity, { [key]: record.id, customerId: feedback.customerId });
    }
    await repo.update(tx, "feedbacks", feedback.id, { [fk]: record.id });
    await activity(tx, actorId, await accountFor(tx, "feedbacks", feedback), target === "tickets" ? "Suporte" : target === "bugs" ? "Bug" : "Feature Request", `Feedback relacionado a ${definition(target).singular.toLowerCase()}.`, target, record.id, { feedbackId: feedback.id });
    return record;
  }

  const entity = command.entity;
  definition(entity);
  if (["bugCustomers", "featureCustomers"].includes(entity) && command.id) throw new HqError("Associações preservam o histórico.");
  if (entity === "activities" && command.id) throw new HqError("O histórico é imutável.");
  const values = parseValues(entity, command.values);
  const old = command.id ? await repo.find(tx, entity, command.id, true) : null;

  // Uma relação existente não pode ser transferida silenciosamente para outra conta.
  if (old) for (const field of definition(entity).fields) {
    if (field.ref && values[field.key] !== undefined && values[field.key] !== old[field.key]) throw new HqError("Não é permitido transferir o histórico entre contas.");
  }
  if ((entity === "leads" || entity === "customers") && command.account) {
    const accountValues = parseValues("accounts", command.account);
    if (old) await repo.update(tx, "accounts", String(old.accountId), accountValues);
    else {
      const account = await repo.insert(tx, "accounts", accountValues);
      values.accountId = account.id;
    }
  }
  await checkRelations(tx, entity, values);
  if (entity === "leads") {
    if (values.status === "Convertido" && old?.status !== "Convertido") throw new HqError("Use Converter em cliente para preservar os vínculos.");
    if (old?.status === "Convertido" && values.status !== old.status) throw new HqError("O lead já foi convertido.");
  }
  if (entity === "subscriptions") {
    if (Number(values.discountCents) > Number(values.amountCents)) throw new HqError("Desconto maior que o valor da assinatura.");
    if (values.status === "Teste" && !values.trialEnd) throw new HqError("Informe o término do teste.");
    if (String(values.nextBillingAt) < String(values.startedAt)) throw new HqError("A cobrança deve ser posterior ao início.");
    if (values.trialEnd && String(values.trialEnd) < String(values.startedAt)) throw new HqError("O teste deve terminar após o início.");
    values.cancelledAt = values.status === "Cancelado" ? old?.cancelledAt ?? new Date().toISOString() : null;
  }
  if (entity === "payments") {
    if (!old && values.status !== "Pendente") throw new HqError("Crie a cobrança pendente e use Confirmar pagamento.");
    if (old?.status === "Pago") throw new HqError("Pagamento recebido é imutável; preserve o registro para reconciliação.");
    if (old?.status === "Cancelado") throw new HqError("Cobrança cancelada é imutável.");
    if (values.status === "Pago") throw new HqError("Use Confirmar pagamento.");
  }
  if (entity === "followups") values.completedAt = values.status === "Concluído" ? old?.completedAt ?? new Date().toISOString() : null;
  if (entity === "opportunities" && values.stage !== old?.stage) values.stageChangedAt = new Date().toISOString();
  if (entity === "bugs") values.resolvedAt = ["Resolvido", "Fechado"].includes(String(values.status)) ? old?.resolvedAt ?? new Date().toISOString() : null;
  if (entity === "features") {
    values.normalizedTitle = normalizedTitle(String(values.title));
    if (values.normalizedTitle.length < 3) throw new HqError("Informe um título descritivo para a feature.");
  }
  if (entity === "activities") {
    values.actorId = actorId;
    return repo.insert(tx, entity, values);
  }
  if (entity === "feedbacks") {
    const customer = await repo.find(tx, "customers", String(values.customerId));
    if (!old) {
      const entry = await activity(tx, actorId, String(customer.accountId), "Feedback", String(values.description), "feedbacks", "");
      values.activityId = entry.id;
    }
  }
  if (entity === "bugCustomers" || entity === "featureCustomers") {
    const fk = entity === "bugCustomers" ? "bugId" : "featureId";
    await repo.find(tx, entity === "bugCustomers" ? "bugs" : "features", String(values[fk]), true);
    const links = await repo.related(tx, entity, fk, String(values[fk]));
    const existing = links.find(l => l.customerId === values.customerId);
    if (existing) return existing;
  }
  const saved = old ? await repo.update(tx, entity, old.id, values) : await repo.insert(tx, entity, values);
  const accountId = await accountFor(tx, entity, saved);
  if (old && (entity === "bugs" || entity === "features")) {
    const links = await repo.related(tx, entity === "bugs" ? "bugCustomers" : "featureCustomers", entity === "bugs" ? "bugId" : "featureId", saved.id);
    for (const link of links) {
      const customer = await repo.find(tx, "customers", String(link.customerId));
      await activity(tx, actorId, String(customer.accountId), entity === "bugs" ? "Bug" : "Feature Request", `${definition(entity).singular}: ${saved.title} · ${saved.status}`, entity, saved.id, { previous: old, current: saved });
    }
  }
  await activity(tx, actorId, accountId, entity === "tickets" ? "Suporte" : entity === "bugCustomers" ? "Bug" : entity === "featureCustomers" ? "Feature Request" : "Mudança de status", `${definition(entity).singular} ${old ? "atualizado" : "criado"}.`, entity, saved.id, { previous: old, current: saved });
  if (entity === "leads" && !old) {
    await repo.insert(tx, "opportunities", { accountId, title: "Nova oportunidade", valueCents: values.quotedCents, probability: 0, stage: "Novo Lead" });
  }
  return saved;
}
