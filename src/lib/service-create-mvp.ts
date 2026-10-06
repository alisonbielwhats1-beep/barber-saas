import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { actionJournal, assertCurrent, assertUnexpired, confirmJournalAction } from "./secretary-journal";
import type { Tx } from "./prisma-tenant";
import { assertServiceWriter, createCatalogService, updateCatalogService, catalogServiceSnapshot, validateServiceChange, type ServiceActor } from "./service-catalog";
import {
  assessServiceDraft, SERVICE_REQUIREMENTS_VERSION, serviceMvpInput, serviceMvpPatch,
} from "./service-contract";

// Small append-only journal on the existing tenant-scoped AuditLog. No schema change.
// Not a general registry, tool executor or chat memory.
const ENTITY = "SERVICE_CREATE_MVP";
const DRAFT = "SERVICE_CREATE_DRAFT";
const PROPOSAL = "SERVICE_CREATE_PROPOSAL";
const CONFIRMED = "SERVICE_CREATE_CONFIRMED";
const ref = z.string().uuid();
const revision = z.number().int().min(1).max(100);
const changeSchema = z.object({ service_ref: z.string().min(1), service_revision: z.string().regex(/^\d+$/),
  before: serviceMvpInput, patch: serviceMvpPatch, price_type: z.enum(["FIXED", "FROM"]) }).strict();
const draftSchema = z.object({
  draft_ref: ref, draft_revision: revision,
  requirements_version: z.literal(SERVICE_REQUIREMENTS_VERSION),
  fields: serviceMvpPatch, expires_at: z.string().datetime(), change: changeSchema.optional(),
}).strict();
const proposalSchema = z.object({
  proposal_ref: ref, draft_ref: ref, draft_revision: revision,
  requirements_version: z.literal(SERVICE_REQUIREMENTS_VERSION),
  fields: serviceMvpInput, currency: z.literal("BRL"),
  payload_hash: z.string().length(64), expires_at: z.string().datetime(),
  preview: z.string(),
  change: changeSchema.optional(),
}).strict();
const receiptSchema = z.object({
  proposal_ref: ref, draft_ref: ref, draft_revision: revision,
  service: z.object({ id: z.string(), name: z.string(), durationMin: z.number(), priceCents: z.number() }),
}).strict();

export const upsertDraftInput = z.object({
  draft_ref: ref.optional(), expected_revision: revision.optional(), patch: serviceMvpPatch,
  service_ref: z.string().min(1).optional(),
}).strict().refine((x) => Boolean(x.draft_ref) === Boolean(x.expected_revision), "REVISION_REQUIRED");
export const proposeServiceInput = z.object({ draft_ref: ref, draft_revision: revision }).strict();
export const confirmServiceInput = z.object({ proposal_ref: ref, draft_revision: revision }).strict();

function hash(fields: z.infer<typeof serviceMvpInput>, change?: z.infer<typeof changeSchema>) {
  return createHash("sha256").update(JSON.stringify({
    name: fields.name, priceCents: fields.priceCents, durationMin: fields.durationMin,
    currency: "BRL", requirements_version: SERVICE_REQUIREMENTS_VERSION,
    ...(change ? { change } : {}),
  })).digest("hex");
}

const journal = actionJournal(ENTITY);
const { scope, lock, append } = journal;

async function latestDraft(tx: Tx, actor: ServiceActor, draftRef: string) {
  const rows = await tx.auditLog.findMany({
    where: { ...scope(actor), action: DRAFT, entityId: draftRef },
  });
  const drafts = rows.map((row) => draftSchema.parse(row.metadata));
  const latest = drafts.sort((a, b) => b.draft_revision - a.draft_revision)[0];
  if (!latest) throw new Error("DRAFT_NOT_FOUND");
  return latest;
}

async function authorize(tx: Tx, actor: ServiceActor) {
  const salon = await assertServiceWriter(tx, actor);
  if (salon.currency !== "BRL") throw new Error("CURRENCY_NOT_SUPPORTED");
}

export async function upsertActionDraft(tx: Tx, actor: ServiceActor, input: unknown) {
  await authorize(tx, actor);
  const parsed = upsertDraftInput.parse(input);
  const patch = Object.fromEntries(Object.entries(parsed.patch).filter(([, value]) => value !== undefined));
  if (!Object.keys(patch).length) throw new Error("EMPTY_PATCH");
  const draftRef = parsed.draft_ref ?? randomUUID();
  await lock(tx, actor, draftRef);
  const previous = parsed.draft_ref ? await latestDraft(tx, actor, draftRef) : null;
  if (previous) {
    if (parsed.service_ref && parsed.service_ref !== previous.change?.service_ref) throw new Error("PROPOSAL_MISMATCH");
    assertCurrent(previous, parsed.expected_revision!);
    assertUnexpired(previous.expires_at);
    const done = await tx.auditLog.findFirst({ where: {
      ...scope(actor), action: CONFIRMED, entityId: draftRef,
    } });
    if (done) throw new Error("ALREADY_CONFIRMED");
  }
  let change = previous?.change;
  if (change || parsed.service_ref) {
    const snapshot = await catalogServiceSnapshot(tx, actor, change?.service_ref ?? parsed.service_ref!);
    if (change && snapshot.revision !== change.service_revision) throw new Error("SERVICE_CHANGED");
    const combined = serviceMvpPatch.parse({ ...change?.patch, ...patch });
    validateServiceChange(snapshot.service, combined);
    change = changeSchema.parse({ service_ref: snapshot.service.id, service_revision: snapshot.revision,
      before: change?.before ?? { name: snapshot.service.name, priceCents: snapshot.service.priceCents, durationMin: snapshot.service.durationMin }, patch: combined, price_type: snapshot.service.priceType });
    if (Object.entries(combined).every(([key, value]) => change!.before[key as "name" | "priceCents" | "durationMin"] === value)) throw new Error("NO_CHANGE");
  }
  const draft = draftSchema.parse({
    draft_ref: draftRef, draft_revision: (previous?.draft_revision ?? 0) + 1,
    requirements_version: SERVICE_REQUIREMENTS_VERSION,
    fields: { ...change?.before, ...previous?.fields, ...patch },
    ...(change ? { change } : {}),
    expires_at: previous?.expires_at ?? new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  await append(tx, actor, DRAFT, draftRef, draft);
  return { ...draft, ...assessServiceDraft(draft.fields) };
}

export async function proposeServiceCreate(tx: Tx, actor: ServiceActor, input: unknown) {
  return proposeService(tx, actor, input, false);
}
export async function proposeServiceChange(tx: Tx, actor: ServiceActor, input: unknown) {
  return proposeService(tx, actor, input, true);
}
async function proposeService(tx: Tx, actor: ServiceActor, input: unknown, isChange: boolean) {
  await authorize(tx, actor);
  const parsed = proposeServiceInput.parse(input);
  await lock(tx, actor, parsed.draft_ref);
  const draft = await latestDraft(tx, actor, parsed.draft_ref);
  assertCurrent(draft, parsed.draft_revision);
  assertUnexpired(draft.expires_at);
  if (Boolean(draft.change) !== isChange) throw new Error("OPERATION_MISMATCH");
  if (draft.change) {
    const snapshot = await catalogServiceSnapshot(tx, actor, draft.change.service_ref);
    if (snapshot.revision !== draft.change.service_revision) throw new Error("SERVICE_CHANGED");
    validateServiceChange(snapshot.service, draft.change.patch);
  }
  const fields = serviceMvpInput.parse(draft.fields);
  const previous = await tx.auditLog.findMany({ where: {
    ...scope(actor), action: PROPOSAL, entityId: parsed.draft_ref,
  } });
  const existing = previous.map((row) => proposalSchema.parse(row.metadata))
    .find((proposal) => proposal.draft_revision === draft.draft_revision);
  if (existing) { assertUnexpired(existing.expires_at); return existing; }
  const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(fields.priceCents / 100);
  const proposal = proposalSchema.parse({
    proposal_ref: randomUUID(), draft_ref: draft.draft_ref, draft_revision: draft.draft_revision,
    requirements_version: SERVICE_REQUIREMENTS_VERSION, fields, currency: "BRL",
    payload_hash: hash(fields, draft.change),
    ...(draft.change ? { change: draft.change } : {}),
    expires_at: new Date(Math.min(Date.parse(draft.expires_at), Date.now() + 10 * 60_000)).toISOString(),
    preview: draft.change ? changePreview(draft.change, fields) : `${fields.name}\n${price}\n${fields.durationMin} minutos\nSem categoria e sem profissional vinculado.\nPadrões existentes: preço fixo; ativo; custo R$ 0,00; processamento e finalização 0 min; sem variante ou recurso físico; descrição, imagem e cor não informadas.`,
  });
  await append(tx, actor, PROPOSAL, draft.draft_ref, proposal, proposal.proposal_ref);
  return proposal;
}

function changePreview(change: z.infer<typeof changeSchema>, after: z.infer<typeof serviceMvpInput>) {
  const money = (v: number) => `${change.price_type === "FROM" ? "A partir de " : ""}${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v / 100)}`;
  const line = (label: string, before: string, next: string) => `${label}: ${before === next ? `${before} (sem alteração)` : `${before} → ${next}`}`;
  return [line("Nome", change.before.name, after.name), line("Preço", money(change.before.priceCents), money(after.priceCents)),
    line("Duração", `${change.before.durationMin} minutos`, `${after.durationMin} minutos`), "Demais campos e relações preservados."].join("\n");
}

export async function confirmServiceCreate(tx: Tx, actor: ServiceActor, input: unknown) {
  const parsed = confirmServiceInput.parse(input);
  return confirmJournalAction(tx, actor, parsed, {
    journal, proposalAction: PROPOSAL, confirmedAction: CONFIRMED,
    authorize: () => authorize(tx, actor), parseProposal: x => proposalSchema.parse(x), parseReceipt: x => receiptSchema.parse(x),
    latest: ref => latestDraft(tx, actor, ref), proposalHash: p => hash(p.fields, p.change),
    draftHash: d => hash(serviceMvpInput.parse(d.fields), d.change),
    execute: async (proposal, draft) => {
      const service = proposal.change
        ? await updateCatalogService(tx, actor, proposal.change.service_ref, proposal.change.patch, proposal.change.service_revision)
        : await createCatalogService(tx, actor, proposal.fields);
      return receiptSchema.parse({ proposal_ref: proposal.proposal_ref, draft_ref: draft.draft_ref, draft_revision: draft.draft_revision,
        service: { id: service.id, name: service.name, priceCents: service.priceCents, durationMin: service.durationMin } });
    },
  });
}
