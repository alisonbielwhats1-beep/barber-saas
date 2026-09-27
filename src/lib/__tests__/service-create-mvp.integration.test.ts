import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../prisma";
import { withSalon, withTenant } from "../prisma-tenant";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { createCatalogService, updateCatalogService, type ServiceActor } from "../service-catalog";
import { parseServiceMvpMessage } from "../service-contract";
import { confirmServiceCreate, proposeServiceCreate, upsertActionDraft } from "../service-create-mvp";

const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });

const fixtureSalons:string[]=[];
async function fixture(role: "OWNER" | "MANAGER" | "RECEPTIONIST" = "OWNER") {
  const id = crypto.randomUUID();
  const user = await admin.user.create({ data: {
    name: "Synthetic MVP owner", email: `service-mvp-${id}@example.test`, passwordHash: "not-a-login-hash",
  } });
  await admin.$transaction((tx) => withSalon(id, async (scoped) => {
    await scoped.salon.create({ data: { id, name: "Synthetic service MVP", slug: `service-mvp-${id}`, accessStatus: "APPROVED" } });
    await scoped.membership.create({ data: { salonId: id, userId: user.id, role } });
  }, tx));
  fixtureSalons.push(id);
  return { salonId: id, userId: user.id };
}

async function draft(actor: ServiceActor, complete = false) {
  return withTenant(actor, (tx) => upsertActionDraft(tx, actor, {
    patch: { name: "Massagem", priceCents: 5000, ...(complete ? { durationMin: 60 } : {}) },
  }));
}
async function ready(actor: ServiceActor) {
  const state = await draft(actor, true);
  return withTenant(actor, (tx) => proposeServiceCreate(tx, actor, {
    draft_ref: state.draft_ref, draft_revision: state.draft_revision,
  }));
}
async function confirm(actor: ServiceActor, proposal: { proposal_ref: string; draft_revision: number }) {
  return withTenant(actor, (tx) => confirmServiceCreate(tx, actor, {
    proposal_ref: proposal.proposal_ref, draft_revision: proposal.draft_revision,
  }));
}
async function serviceCount(actor: ServiceActor) {
  return withTenant(actor, (tx) => tx.service.count({ where: { salonId: actor.salonId } }));
}

suite("service-create MVP on disposable native PostgreSQL with FORCE RLS", () => {
  beforeAll(async () => {
    await assertMvpTestDatabase(admin); // No fixture write occurs before this gate.
    const [role] = await prisma.$queryRaw<{ name: string; super: boolean; bypass: boolean }[]>`
      SELECT current_user AS name, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({ name: "mvp_service_runtime", super: false, bypass: false });
    const policies = await admin.$queryRaw<{ name: string; enabled: boolean; forced: boolean }[]>`
      SELECT relname AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class WHERE relname IN ('Service','AuditLog','Salon','Membership')`;
    expect(policies).toHaveLength(4);
    expect(policies.every((p) => p.enabled && p.forced)).toBe(true);
    expect(await admin.clientProfile.count({where:{salonId:{in:fixtureSalons}}})).toBe(0);
    expect(await admin.appointment.count({where:{salonId:{in:fixtureSalons}}})).toBe(0);
  });
  afterAll(async () => { await admin.$disconnect(); await prisma.$disconnect(); });

  it("1–6: asks duration, retains the same draft, creates only on confirmation and returns the same reference on retry", async () => {
    const actor = await fixture();
    const first = await withTenant(actor, (tx) => upsertActionDraft(tx, actor, {
      patch: parseServiceMvpMessage("Cadastre uma massagem por R$50"),
    }));
    expect(first).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["durationMin"], fields: { name: "Massagem", priceCents: 5000 } });
    expect(first.question).toContain("duração");
    expect(await serviceCount(actor)).toBe(0);
    await expect(withTenant(actor, (tx) => proposeServiceCreate(tx, actor, {
      draft_ref: first.draft_ref, draft_revision: first.draft_revision,
    }))).rejects.toThrow();
    const second = await withTenant(actor, (tx) => upsertActionDraft(tx, actor, {
      draft_ref: first.draft_ref, expected_revision: first.draft_revision,
      patch: parseServiceMvpMessage("60 minutos"),
    }));
    expect(second).toMatchObject({ draft_ref: first.draft_ref, draft_revision: 2, status: "READY", missing_fields: [], fields: { name: "Massagem", priceCents: 5000, durationMin: 60 } });
    const proposal = await withTenant(actor, (tx) => proposeServiceCreate(tx, actor, {
      draft_ref: second.draft_ref, draft_revision: second.draft_revision,
    }));
    expect(proposal.preview.replaceAll("\u00a0", " ")).toContain("Massagem\nR$ 50,00\n60 minutos");
    expect(await serviceCount(actor)).toBe(0);
    const result = await confirm(actor, proposal);
    const repeated = await confirm(actor, proposal);
    expect(result.duplicate).toBe(false);
    expect(repeated).toEqual({ ...result, duplicate: true });
    expect(await serviceCount(actor)).toBe(1);
    const saved = await withTenant(actor, (tx) => tx.service.findFirstOrThrow({ where: { id: result.service.id, salonId: actor.salonId } }));
    expect(saved).toMatchObject({ name: "Massagem", durationMin: 60, priceCents: 5000, category: null, priceType: "FIXED", priceNote: null, variantGroup: null, processingMin: 0, finishingMin: 0, physicalResourceId: null });
    expect(await withTenant(actor, (tx) => tx.professionalService.count({ where: { serviceId: saved.id } }))).toBe(0);
    console.log("SERVICE_MVP_EVIDENCE", JSON.stringify({ database: "everflair_service_mvp", service: result.service, draftRef: first.draft_ref, revision: second.draft_revision, beforeConfirmation: 0, afterRepeatedConfirmation: 1, duplicate: repeated.duplicate }));
  });

  it("7: rejects invalid duration without changing the persisted draft", async () => {
    const actor = await fixture(); const first = await draft(actor);
    await expect(withTenant(actor, (tx) => upsertActionDraft(tx, actor, {
      draft_ref: first.draft_ref, expected_revision: 1, patch: { durationMin: 4 },
    }))).rejects.toThrow();
    const next = await withTenant(actor, (tx) => upsertActionDraft(tx, actor, {
      draft_ref: first.draft_ref, expected_revision: 1, patch: { durationMin: 60 },
    }));
    expect(next.draft_revision).toBe(2);
    expect(next.fields).toEqual({ name: "Massagem", priceCents: 5000, durationMin: 60 });
    expect(await serviceCount(actor)).toBe(0);
  });

  it("8: rejects old draft/proposal revisions and never executes the stale payload", async () => {
    const actor = await fixture(); const proposal = await ready(actor);
    await withTenant(actor, (tx) => upsertActionDraft(tx, actor, {
      draft_ref: proposal.draft_ref, expected_revision: 1, patch: { durationMin: 90 },
    }));
    await expect(confirm(actor, proposal)).rejects.toThrow("REVISION_CONFLICT");
    await expect(confirm(actor, { ...proposal, draft_revision: 2 })).rejects.toThrow("PROPOSAL_MISMATCH");
    await expect(withTenant(actor, (tx) => upsertActionDraft(tx, actor, {
      draft_ref: proposal.draft_ref, expected_revision: 1, patch: { priceCents: 1 },
    }))).rejects.toThrow("REVISION_CONFLICT");
    expect(await serviceCount(actor)).toBe(0);
  });

  it("9: rechecks membership at confirmation, including after successful execution", async () => {
    const actor = await fixture(); const proposal = await ready(actor);
    await admin.$transaction((tx) => withSalon(actor.salonId, (scoped) => scoped.membership.updateMany({ where: actor, data: { role: "RECEPTIONIST" } }), tx));
    await expect(confirm(actor, proposal)).rejects.toThrow("FORBIDDEN");
    expect(await serviceCount(actor)).toBe(0);
    await admin.$transaction((tx) => withSalon(actor.salonId, (scoped) => scoped.membership.updateMany({ where: actor, data: { role: "OWNER" } }), tx));
    await confirm(actor, proposal);
    await admin.$transaction((tx) => withSalon(actor.salonId, (scoped) => scoped.membership.updateMany({ where: actor, data: { role: "RECEPTIONIST" } }), tx));
    await expect(confirm(actor, proposal)).rejects.toThrow("FORBIDDEN");
  });

  it("rejects a salon suspended after the proposal", async () => {
    const actor = await fixture(); const proposal = await ready(actor);
    await admin.$transaction((tx) => withSalon(actor.salonId, (scoped) => scoped.salon.update({ where: { id: actor.salonId }, data: { accessStatus: "SUSPENDED" } }), tx));
    await expect(confirm(actor, proposal)).rejects.toThrow("FORBIDDEN");
    expect(await serviceCount(actor)).toBe(0);
  });

  it("serializes two concurrent confirmations into exactly one service and receipt", async () => {
    const actor = await fixture(); const proposal = await ready(actor);
    const results = await Promise.all([confirm(actor, proposal), confirm(actor, proposal)]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect(results[0].service.id).toBe(results[1].service.id);
    expect(await serviceCount(actor)).toBe(1);
    expect(await withTenant(actor, (tx) => tx.auditLog.count({ where: { salonId: actor.salonId, action: "SERVICE_CREATE_CONFIRMED" } }))).toBe(1);
  });

  it("reuses the proposal for the same revision and forbids editing a confirmed draft", async () => {
    const actor = await fixture(); const proposal = await ready(actor);
    expect(await withTenant(actor, (tx) => proposeServiceCreate(tx, actor, {
      draft_ref: proposal.draft_ref, draft_revision: proposal.draft_revision,
    }))).toEqual(proposal);
    await confirm(actor, proposal);
    await expect(withTenant(actor, (tx) => upsertActionDraft(tx, actor, {
      draft_ref: proposal.draft_ref, expected_revision: 1, patch: { durationMin: 90 },
    }))).rejects.toThrow("ALREADY_CONFIRMED");
  });

  it("rejects an expired proposal without executing", async () => {
    const actor = await fixture(); const proposal = await ready(actor);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(proposal.expires_at) + 1);
    try { await expect(confirm(actor, proposal)).rejects.toThrow("EXPIRED"); }
    finally { clock.mockRestore(); }
    expect(await serviceCount(actor)).toBe(0);
  });

  it("binds proposals to their author even if another owner belongs to the same salon", async () => {
    const actor = await fixture(); const other = await fixture(); const proposal = await ready(actor);
    await admin.$transaction((tx) => withSalon(actor.salonId, (scoped) => scoped.membership.create({
      data: { salonId: actor.salonId, userId: other.userId, role: "OWNER" },
    }), tx));
    await expect(confirm({ ...actor, userId: other.userId }, proposal)).rejects.toThrow("PROPOSAL_NOT_FOUND");
    expect(await serviceCount(actor)).toBe(0);
  });

  it("rejects foreign or inactive physical resources in the shared service domain", async () => {
    const actor = await fixture(); const other = await fixture();
    const resource = await admin.$transaction((tx) => withSalon(other.salonId, (scoped) => scoped.physicalResource.create({
      data: { salonId: other.salonId, name: "Unavailable synthetic room", kind: "ROOM", active: false },
    }), tx));
    const input = { name: "Massagem", durationMin: 60, priceCents: 5000, physicalResourceId: resource.id };
    await expect(withTenant(actor, (tx) => createCatalogService(tx, actor, input))).rejects.toThrow("Recurso inválido");
    await expect(withTenant(other, (tx) => createCatalogService(tx, other, input))).rejects.toThrow("Recurso inválido");
    expect(await serviceCount(actor)).toBe(0); expect(await serviceCount(other)).toBe(0);
  });

  it("rolls back service creation if the transaction fails before commit", async () => {
    const actor = await fixture(); const proposal = await ready(actor);
    await expect(withTenant(actor, async (tx) => {
      await confirmServiceCreate(tx, actor, { proposal_ref: proposal.proposal_ref, draft_revision: 1 });
      throw new Error("TEST_ROLLBACK");
    })).rejects.toThrow("TEST_ROLLBACK");
    expect(await serviceCount(actor)).toBe(0);
    expect((await confirm(actor, proposal)).duplicate).toBe(false);
    expect(await serviceCount(actor)).toBe(1);
  });

  it("blocks cross-tenant/other-actor drafts and rejects payload injection into confirmation", async () => {
    const a = await fixture(); const b = await fixture(); const proposal = await ready(a);
    await expect(confirm(b, proposal)).rejects.toThrow("PROPOSAL_NOT_FOUND");
    await expect(withTenant(b, (tx) => upsertActionDraft(tx, b, { draft_ref: proposal.draft_ref, expected_revision: 1, patch: { durationMin: 60 } }))).rejects.toThrow("DRAFT_NOT_FOUND");
    await expect(withTenant(a, (tx) => confirmServiceCreate(tx, a, { proposal_ref: proposal.proposal_ref, draft_revision: 1, fields: { priceCents: 1 } }))).rejects.toThrow();
    expect(await withTenant(b, (tx) => tx.auditLog.count({ where: { salonId: a.salonId } }))).toBe(0);
    expect(await serviceCount(a)).toBe(0); expect(await serviceCount(b)).toBe(0);
  });

  it("preserves FROM pricing, variant, processing, finishing and resource when omitted from an update", async () => {
    const actor = await fixture();
    const resource = await admin.$transaction((tx) => withSalon(actor.salonId, (scoped) => scoped.physicalResource.create({ data: { salonId: actor.salonId, name: "Synthetic room", kind: "ROOM" } }), tx));
    const saved = await withTenant(actor, (tx) => createCatalogService(tx, actor, {
      name: "Coloração", durationMin: 90, priceCents: 9000, priceType: "FROM", priceNote: "Conforme avaliação",
      variantGroup: "Coloração", variantLabel: "Longo", processingMin: 30, finishingMin: 15,
      physicalResourceId: resource.id, category: "Cor", description: "Preservar", costCents: 1200,
    }));
    const updated = await withTenant(actor, (tx) => updateCatalogService(tx, actor, saved.id, { priceCents: 10000 }));
    expect(updated).toEqual({ ...saved, priceCents: 10000 });
    const cleared = await withTenant(actor, (tx) => updateCatalogService(tx, actor, saved.id, { description: null, processingMin: 0 }));
    expect(cleared).toEqual({ ...updated, description: null, processingMin: 0 });
    await expect(withTenant(actor, (tx) => updateCatalogService(tx, actor, saved.id, { durationMin: 15 }))).rejects.toThrow("Execução");
    const fixed = await withTenant(actor, (tx) => updateCatalogService(tx, actor, saved.id, { priceType: "FIXED" }));
    expect(fixed).toMatchObject({ priceType: "FIXED", priceNote: null, finishingMin: 15, physicalResourceId: resource.id });
  });

  it("never reports success for missing or foreign services", async () => {
    const a = await fixture(); const b = await fixture();
    const saved = await withTenant(a, (tx) => createCatalogService(tx, a, { name: "Teste", priceCents: 0, durationMin: 10 }));
    await expect(withTenant(b, (tx) => updateCatalogService(tx, b, saved.id, { name: "Outro" }))).rejects.toThrow("SERVICE_NOT_FOUND");
    await expect(withTenant(a, (tx) => updateCatalogService(tx, a, "missing", { name: "Outro" }))).rejects.toThrow("SERVICE_NOT_FOUND");
  });

  it("10: never creates customers, appointments, products or payments", async () => {
    expect(await admin.clientProfile.count({where:{salonId:{in:fixtureSalons}}})).toBe(0);
    expect(await admin.appointment.count({where:{salonId:{in:fixtureSalons}}})).toBe(0);
    expect(await admin.product.count({where:{salonId:{in:fixtureSalons}}})).toBe(0);
    expect(await admin.payment.count({where:{appointment:{salonId:{in:fixtureSalons}}}})).toBe(0);
  });
});
