import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { actionJournal, assertCurrent, assertUnexpired, confirmJournalAction } from "./secretary-journal";
import { proposeServiceInput, confirmServiceInput } from "./service-create-mvp";
import { customerDTO, customerInput, customerOperation, customerPatch } from "./customer-contract";
import { assertCustomerAccess, customerSnapshot, customerDuplicates, normalizedCustomerPatch, executeCustomerPatch } from "./customer-catalog";

const journal = actionJournal("SECRETARY_CUSTOMERS");
const changeSchema = z.object({ customer_ref: z.string(), customer_revision: z.string().regex(/^\d+$/), before: customerInput }).strict();
const draftSchema = z.object({ draft_ref: z.string().uuid(), draft_revision: z.number().int().min(1).max(100), operation: customerOperation,
  fields: customerPatch, patch: customerPatch, requested_fields: z.array(z.enum(["name", "phone", "email"])),
  change: changeSchema.optional(), expires_at: z.string().datetime() }).strict();
const proposalSchema = draftSchema.extend({ proposal_ref: z.string().uuid(), payload_hash: z.string().length(64), preview: z.string() });
const receiptSchema = z.object({ proposal_ref: z.string().uuid(), draft_ref: z.string().uuid(), draft_revision: z.number(), customer: customerDTO }).strict();
const inputSchema = z.object({ operation: customerOperation, draft_ref: z.string().uuid().optional(), expected_revision: z.number().int().min(1).optional(),
  customer_ref: z.string().optional(), patch: customerPatch, requested_fields: z.array(z.enum(["name", "phone", "email"])).default([]) }).strict()
  .refine(x => Boolean(x.draft_ref) === Boolean(x.expected_revision), "REVISION_REQUIRED");
async function latest(tx: Tx, actor: ServiceActor, ref: string) {
  const rows = await tx.auditLog.findMany({ where: { ...journal.scope(actor), action: "DRAFT", entityId: ref }, select: { metadata: true } });
  const draft = rows.map(x => draftSchema.parse(x.metadata)).sort((a,b) => b.draft_revision-a.draft_revision)[0];
  if (!draft) throw new Error("DRAFT_NOT_FOUND");
  return draft;
}
function hash(d: z.infer<typeof draftSchema>) {
  return createHash("sha256").update(JSON.stringify({ operation: d.operation, fields: d.fields, patch: d.patch, change: d.change, requested_fields: d.requested_fields, requirements: "customer-v1" })).digest("hex");
}
function assess(d: z.infer<typeof draftSchema>) {
  const missing_fields = [...new Set([...(d.operation === "customer.create" && !d.fields.name ? ["name" as const] : []),
    ...d.requested_fields.filter(k => d.patch[k] === undefined)])];
  return { ...d, status: missing_fields.length || !Object.keys(d.patch).length ? "NEEDS_INPUT" as const : "READY" as const, missing_fields };
}
/** U03 Customers adapter: same append-only journal, revisions and confirmation engine. */
export async function upsertCustomerDraft(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertCustomerAccess(tx, actor);
  const parsed = inputSchema.parse(input); const ref = parsed.draft_ref ?? randomUUID();
  await journal.lock(tx, actor, ref);
  const previous = parsed.draft_ref ? await latest(tx, actor, ref) : undefined;
  if (previous) {
    assertCurrent(previous, parsed.expected_revision!); assertUnexpired(previous.expires_at);
    if (previous.operation !== parsed.operation || (parsed.customer_ref && previous.change?.customer_ref !== parsed.customer_ref)) throw new Error("OPERATION_MISMATCH");
    if (await tx.auditLog.findFirst({ where: { ...journal.scope(actor), action: "CONFIRMED", entityId: ref } })) throw new Error("ALREADY_CONFIRMED");
  }
  let change = previous?.change;
  if (parsed.operation === "customer.change") {
    const target = change?.customer_ref ?? parsed.customer_ref;
    if (!target) throw new Error("CUSTOMER_NOT_FOUND");
    const snap = await customerSnapshot(tx, actor, target);
    if (change && snap.revision !== change.customer_revision) throw new Error("CUSTOMER_CHANGED");
    change ??= { customer_ref: target, customer_revision: snap.revision, before: { name: snap.customer.name, phone: snap.customer.phone, email: snap.customer.email } };
  } else if (parsed.customer_ref) throw new Error("OPERATION_MISMATCH");
  const patch = normalizedCustomerPatch({ ...previous?.patch, ...parsed.patch });
  const draft = draftSchema.parse({ draft_ref: ref, draft_revision: (previous?.draft_revision ?? 0)+1, operation: parsed.operation,
    patch, fields: { ...change?.before, ...previous?.fields, ...patch }, change,
    requested_fields: [...new Set([...(previous?.requested_fields ?? []), ...parsed.requested_fields])],
    expires_at: previous?.expires_at ?? new Date(Date.now()+30*60000).toISOString() });
  await journal.append(tx, actor, "DRAFT", ref, draft);
  return assess(draft);
}
/** T19: never mutates ClientProfile. */
export async function proposeCustomerChange(tx: Tx, actor: ServiceActor, input: unknown) {
  await assertCustomerAccess(tx, actor);
  const parsed = proposeServiceInput.parse(input); await journal.lock(tx, actor, parsed.draft_ref);
  const d = await latest(tx, actor, parsed.draft_ref); assertCurrent(d, parsed.draft_revision); assertUnexpired(d.expires_at);
  if (assess(d).status !== "READY") throw new Error("NEEDS_INPUT");
  customerInput.parse(d.fields);
  if (d.change && (await customerSnapshot(tx, actor, d.change.customer_ref)).revision !== d.change.customer_revision) throw new Error("CUSTOMER_CHANGED");
  if ((await customerDuplicates(tx, actor, d.fields, d.change?.customer_ref)).length) throw new Error("DUPLICATE_CANDIDATE");
  const old = await tx.auditLog.findMany({ where: { ...journal.scope(actor), action: "PROPOSAL", entityId: d.draft_ref }, select: { metadata: true } });
  const existing = old.map(x=>proposalSchema.parse(x.metadata)).find(p=>p.draft_revision===d.draft_revision);
  if (existing) { assertUnexpired(existing.expires_at); return existing; }
  const labels = { name: "Nome", phone: "Telefone", email: "E-mail" };
  const preview = (["name", "phone", "email"] as const).map(k => {
    const before = d.change?.before[k] ?? null, after = d.fields[k] ?? null;
    return `${labels[k]}: ${d.change ? (before === after ? `${after ?? "Não informado"} (sem alteração)` : `${before ?? "Não informado"} → ${after ?? "Remover"}`) : after ?? "Não informado"}`;
  }).join("\n");
  const proposal = proposalSchema.parse({ ...d, proposal_ref: randomUUID(), payload_hash: hash(d), preview,
    expires_at: new Date(Math.min(Date.parse(d.expires_at), Date.now()+10*60000)).toISOString() });
  await journal.append(tx, actor, "PROPOSAL", d.draft_ref, proposal, proposal.proposal_ref); return proposal;
}
export async function confirmCustomerChange(tx: Tx, actor: ServiceActor, input: unknown) {
  return confirmJournalAction<z.infer<typeof draftSchema>, z.infer<typeof proposalSchema>, z.infer<typeof receiptSchema>>(tx, actor, confirmServiceInput.parse(input), {
    journal, proposalAction: "PROPOSAL", confirmedAction: "CONFIRMED", authorize: () => assertCustomerAccess(tx, actor),
    parseProposal: x=>proposalSchema.parse(x), parseReceipt: x=>receiptSchema.parse(x), latest: ref=>latest(tx, actor, ref), proposalHash: hash, draftHash: hash,
    execute: async (p,d) => receiptSchema.parse({ proposal_ref: p.proposal_ref, draft_ref: d.draft_ref, draft_revision: d.draft_revision,
      customer: await executeCustomerPatch(tx, actor, p.patch, p.change ? { id: p.change.customer_ref, revision: p.change.customer_revision } : undefined) }),
  });
}
