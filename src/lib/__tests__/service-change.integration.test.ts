import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary } from "../salon-secretary";
import { createCatalogService, updateCatalogService, type ServiceActor } from "../service-catalog";
import { upsertActionDraft, proposeServiceChange, confirmServiceCreate } from "../service-create-mvp";
import { ScriptedServicesModel, call, serviceScript } from "../../test/scripted-services-model";

const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
async function fixture() {
  const salonId = crypto.randomUUID();
  const user = await admin.user.create({ data: { name: "Synthetic T18", email: `t18-${salonId}@example.test`, passwordHash: "not-a-login-hash" } });
  await admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    await tx.salon.create({ data: { id: salonId, slug: `t18-${salonId}`, name: "Synthetic T18", accessStatus: "APPROVED" } });
    await tx.membership.create({ data: { salonId, userId: user.id, role: "OWNER" } });
  });
  const actor = { salonId, userId: user.id };
  const service = await withTenant(actor, tx => createCatalogService(tx, actor, { name: "Massagem", priceCents: 5000, durationMin: 60,
    description: "Synthetic retained description", category: "Synthetic category", costCents: 700, processingMin: 10, finishingMin: 5 }));
  return { actor, service };
}
const read = (a: ServiceActor, id: string) => withTenant(a, tx => tx.service.findFirstOrThrow({ where: { id, salonId: a.salonId } }));
const confirmInput = (s: Awaited<ReturnType<SalonSecretary["send"]>>) => ({ proposal_ref: s.proposal!.proposal_ref, draft_revision: s.proposal!.draft_revision });
function model(patch: object, target = "massagem") {
  return new ScriptedServicesModel([call("upsert_action_draft", { operation: "service.change", target_name: target, name: null, priceCents: null, durationMin: null, ...patch })]);
}
suite("T18 — actual PostgreSQL, fake model only", () => {
  const network = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => {
    console.log("T18_DATABASE_PREFLIGHT", await assertMvpTestDatabase(admin));
    const [role] = await prisma.$queryRaw<{ name: string; super: boolean; bypass: boolean }[]>`SELECT current_user AS name,rolsuper AS super,rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({ name: "mvp_service_runtime", super: false, bypass: false });
    const policies = await admin.$queryRaw<{ enabled: boolean; forced: boolean }[]>`SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE relname IN ('Service','AuditLog','Salon','Membership')`;
    expect(policies).toHaveLength(4); expect(policies.every(p => p.enabled && p.forced)).toBe(true);
    vi.stubGlobal("fetch", network);
  });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin.$disconnect(); await prisma.$disconnect(); });
  it.each([
    ["Altere o preço da massagem para R$60.", { priceCents: 6000 }],
    ["Mude a duração da massagem para 45 minutos.", { durationMin: 45 }],
    ["Altere Massagem para Massagem Relaxante.", { name: "Massagem Relaxante" }],
  ] as const)("A/B/C/F: %s", async (message, patch) => {
    const { actor, service } = await fixture(); const fake = model(patch);
    const secretary = new SalonSecretary(async () => fake, () => "fake-services");
    const session = await secretary.start(actor);
    const state = await secretary.send(actor, { sessionId: session.sessionId, message });
    expect(state.draft?.status).toBe("READY");
    expect(state.proposal?.change?.patch).toEqual(patch);
    expect(state.proposal?.change?.before).toEqual({ name: "Massagem", priceCents: 5000, durationMin: 60 });
    expect(state.proposal?.preview).toContain("→");
    expect(await read(actor, service.id)).toEqual(service);
    const confirmed = await secretary.confirm(actor, session.sessionId, confirmInput(state));
    expect(confirmed.receipt?.duplicate).toBe(false);
    const after = await read(actor, service.id);
    expect(after).toEqual({ ...service, ...patch });
    const repeated = await secretary.confirm(actor, session.sessionId, confirmInput(state));
    expect(repeated.receipt?.duplicate).toBe(true);
    expect(repeated.receipt?.service.id).toBe(service.id);
    expect(await read(actor, service.id)).toEqual(after);
    expect(fake.requests).toHaveLength(1);
  });
  it("D: no match creates no business journal/draft and performs no service write", async () => {
    const { actor, service } = await fixture(); const secretary = new SalonSecretary(async () => model({ priceCents: 6000 }, "Inexistente"), () => "fake-services");
    const session = await secretary.start(actor); const state = await secretary.send(actor, { sessionId: session.sessionId, message: "Altere inexistente para 60" });
    expect(state.message).toContain("Não encontrei"); expect(state.draft).toBeUndefined();
    expect(await withTenant(actor, tx => tx.auditLog.count({ where: { salonId: actor.salonId, entityType: "SERVICE_CREATE_MVP" } }))).toBe(0);
    expect(await read(actor, service.id)).toEqual(service);
  });
  it("E/H: ambiguous match requires authenticated selection and blocks foreign selection/session", async () => {
    const { actor, service } = await fixture(); const foreign = await fixture();
    const second = await withTenant(actor, tx => createCatalogService(tx, actor, { name: "Massagem relaxante", priceCents: 7000, durationMin: 90 }));
    const fake = model({ priceCents: 6000 }); const secretary = new SalonSecretary(async () => fake, () => "fake-services");
    const session = await secretary.start(actor); const state = await secretary.send(actor, { sessionId: session.sessionId, message: "Altere a massagem para 60" });
    expect(state.candidates).toHaveLength(2); expect(state.proposal).toBeUndefined(); expect(state.draft).toBeUndefined();
    await expect(secretary.selectService(foreign.actor, session.sessionId, service.id)).rejects.toThrow("SESSION_NOT_FOUND");
    await expect(secretary.selectService(actor, session.sessionId, foreign.service.id)).rejects.toThrow("SELECTION_INVALID");
    const selected = await secretary.selectService(actor, session.sessionId, second.id);
    expect(selected.proposal?.change?.service_ref).toBe(second.id);
    await expect(secretary.confirm(foreign.actor, session.sessionId, confirmInput(selected))).rejects.toThrow("SESSION_NOT_FOUND");
    await secretary.confirm(actor, session.sessionId, confirmInput(selected));
    expect((await read(actor, second.id)).priceCents).toBe(6000); expect(await read(actor, service.id)).toEqual(service);
    expect(fake.requests).toHaveLength(1);
  });
  it("G: even ABA changes invalidate the row revision and cancel the proposal", async () => {
    const { actor, service } = await fixture(); const secretary = new SalonSecretary(async () => model({ priceCents: 6000 }), () => "fake-services");
    const session = await secretary.start(actor); const state = await secretary.send(actor, { sessionId: session.sessionId, message: "Preço 60" });
    await withTenant(actor, tx => updateCatalogService(tx, actor, service.id, { priceCents: 5500 }));
    await withTenant(actor, tx => updateCatalogService(tx, actor, service.id, { priceCents: 5000 }));
    await expect(secretary.confirm(actor, session.sessionId, confirmInput(state))).rejects.toThrow("SERVICE_CHANGED");
    await expect(secretary.confirm(actor, session.sessionId, confirmInput(state))).rejects.toThrow("PROPOSAL_MISMATCH");
    expect((await read(actor, service.id)).priceCents).toBe(5000);
  });
  it("I: creation still retains the same draft, uses two mock calls, and confirms once", async () => {
    const { actor } = await fixture(); const fake = serviceScript(); const secretary = new SalonSecretary(async () => fake, () => "fake-services");
    const session = await secretary.start(actor);
    const first = await secretary.send(actor, { sessionId: session.sessionId, message: "Cadastre uma massagem por R$50" });
    const second = await secretary.send(actor, { sessionId: session.sessionId, message: "Uma hora" });
    expect(first.draft?.missing_fields).toEqual(["durationMin"]); expect(second.draft?.draft_ref).toBe(first.draft?.draft_ref);
    expect(second.proposal?.change).toBeUndefined();
    const count = () => withTenant(actor, tx => tx.service.count({ where: { salonId: actor.salonId } }));
    expect(await count()).toBe(1);
    await secretary.confirm(actor, session.sessionId, confirmInput(second)); await secretary.confirm(actor, session.sessionId, confirmInput(second));
    expect(await count()).toBe(2); expect(fake.requests).toHaveLength(2);
  });
  it("rejects invalid patches, foreign IDs, duration conflicting with processing, and stale draft revisions", async () => {
    const { actor, service } = await fixture(); const foreign = await fixture();
    for (const patch of [{ durationMin: 10 }, { name: null }, { category: "injected" }, {}]) {
      await expect(withTenant(actor, tx => upsertActionDraft(tx, actor, { service_ref: service.id, patch }))).rejects.toThrow();
    }
    await expect(withTenant(actor, tx => upsertActionDraft(tx, actor, { service_ref: foreign.service.id, patch: { priceCents: 1 } }))).rejects.toThrow("SERVICE_NOT_FOUND");
    const draft = await withTenant(actor, tx => upsertActionDraft(tx, actor, { service_ref: service.id, patch: { priceCents: 6000 } }));
    const proposal = await withTenant(actor, tx => proposeServiceChange(tx, actor, { draft_ref: draft.draft_ref, draft_revision: 1 }));
    await withTenant(actor, tx => upsertActionDraft(tx, actor, { draft_ref: draft.draft_ref, expected_revision: 1, patch: { durationMin: 45 } }));
    await expect(withTenant(actor, tx => confirmServiceCreate(tx, actor, { proposal_ref: proposal.proposal_ref, draft_revision: 1 }))).rejects.toThrow("REVISION_CONFLICT");
  });
  it("concurrent confirmations apply once; the same receipt replay does not change xmin", async () => {
    const { actor, service } = await fixture();
    const draft = await withTenant(actor, tx => upsertActionDraft(tx, actor, { service_ref: service.id, patch: { priceCents: 6000 } }));
    const proposal = await withTenant(actor, tx => proposeServiceChange(tx, actor, { draft_ref: draft.draft_ref, draft_revision: 1 }));
    const input = { proposal_ref: proposal.proposal_ref, draft_revision: 1 };
    const receipts = await Promise.all([1, 2].map(() => withTenant(actor, tx => confirmServiceCreate(tx, actor, input))));
    expect(receipts.map(r => r.duplicate).sort()).toEqual([false, true]);
    const version = () => withTenant(actor, tx => tx.$queryRaw`SELECT xmin::text AS revision FROM "Service" WHERE id=${service.id} AND "salonId"=${actor.salonId}`);
    const first = await version();
    await withTenant(actor, tx => confirmServiceCreate(tx, actor, input));
    expect(await version()).toEqual(first);
  });
  it("preserves FROM pricing and blocks unsupported variant rename and revoked permissions", async () => {
    const { actor, service } = await fixture();
    await withTenant(actor, tx => updateCatalogService(tx, actor, service.id, { priceType: "FROM", priceNote: "Synthetic note" }));
    const draft = await withTenant(actor, tx => upsertActionDraft(tx, actor, { service_ref: service.id, patch: { priceCents: 6000 } }));
    const proposal = await withTenant(actor, tx => proposeServiceChange(tx, actor, { draft_ref: draft.draft_ref, draft_revision: 1 }));
    expect(proposal.preview).toContain("A partir de");
    await withTenant(actor, tx => confirmServiceCreate(tx, actor, { proposal_ref: proposal.proposal_ref, draft_revision: 1 }));
    expect(await read(actor, service.id)).toMatchObject({ priceType: "FROM", priceNote: "Synthetic note", priceCents: 6000 });
    await withTenant(actor, tx => updateCatalogService(tx, actor, service.id, { variantGroup: "Massagem", variantLabel: "Longa" }));
    await expect(withTenant(actor, tx => upsertActionDraft(tx, actor, { service_ref: service.id, patch: { name: "Outra" } }))).rejects.toThrow("VARIANT_RENAME_UNSUPPORTED");
    await withTenant(actor, tx => tx.membership.updateMany({ where: { salonId: actor.salonId, userId: actor.userId }, data: { role: "RECEPTIONIST" } }));
    await expect(withTenant(actor, tx => confirmServiceCreate(tx, actor, { proposal_ref: proposal.proposal_ref, draft_revision: 1 }))).rejects.toThrow("FORBIDDEN");
  });

  it("expired service proposal can renew its same real draft without an empty patch or business write",async()=>{
    const {actor,service}=await fixture();
    const fake=new ScriptedServicesModel([
      call("upsert_action_draft",{operation:"service.change",target_name:"Massagem",name:null,priceCents:6000,durationMin:null}),
      call("upsert_action_draft",{operation:null,target_name:null,name:null,priceCents:null,durationMin:null}),
    ]);
    const secretary=new SalonSecretary(async()=>fake,()=>"fake-services");
    const session=await secretary.start(actor);
    const before=await secretary.send(actor,{sessionId:session.sessionId,message:"Altere a Massagem para sessenta reais."});
    const now=Date.now(),clock=vi.spyOn(Date,"now").mockReturnValue(now+11*60_000);
    try{
      const renewed=await secretary.send(actor,{sessionId:session.sessionId,message:"Pode preparar a proposta de novo."});
      expect(renewed.draft!.draft_ref).toBe(before.draft!.draft_ref);
      expect(renewed.draft!.draft_revision).toBe(before.draft!.draft_revision+1);
      expect(renewed.proposal!.proposal_ref).not.toBe(before.proposal!.proposal_ref);
      expect(renewed.proposal!.change!.patch).toEqual({priceCents:6000});
      expect(await read(actor,service.id)).toEqual(service);
      await expect(withTenant(actor,tx=>confirmServiceCreate(tx,actor,confirmInput(before)))).rejects.toThrow();
      expect(await read(actor,service.id)).toEqual(service);
      const done=await secretary.confirm(actor,session.sessionId,confirmInput(renewed));
      expect(done.receipt!.service.id).toBe(service.id);
      expect(await read(actor,service.id)).toEqual({...service,priceCents:6000});
    }finally{clock.mockRestore();}
  });
});
