import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary } from "../salon-secretary";
import { type ServiceActor } from "../service-catalog";
import { executeCustomerPatch, searchSalonCustomer, getCustomer, customerSnapshot } from "../customer-catalog";
import { upsertCustomerDraft, proposeCustomerChange, confirmCustomerChange } from "../customer-actions";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
async function fixture() {
  const salonId = crypto.randomUUID();
  const user = await admin.user.create({ data: { name: "Synthetic Customers", email: `customers-${salonId}@example.test`, passwordHash: "not-a-login-hash" } });
  await admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    await tx.salon.create({ data: { id: salonId, slug: `customers-${salonId}`, name: "Synthetic Customers", accessStatus: "APPROVED" } });
    await tx.membership.create({ data: { salonId, userId: user.id, role: "OWNER" } });
  });
  return { actor: { salonId, userId: user.id } };
}
const interpretation = (extra: object) => call("upsert_action_draft", { operation: "customer.create", target_name: null, name: null, phone: null, email: null, requested_fields: [], clear_fields: [], ...extra });
const confirmInput = (s: Awaited<ReturnType<SalonSecretary["send"]>>) => ({ proposal_ref: s.customer!.proposal!.proposal_ref, draft_revision: s.customer!.proposal!.draft_revision });
const count = (a: ServiceActor) => withTenant(a,tx=>tx.clientProfile.count({ where: { salonId: a.salonId } }));
const add = (a: ServiceActor, fields: object) => withTenant(a,tx=>executeCustomerPatch(tx,a,fields));
const read = (a: ServiceActor,id: string) => withTenant(a,tx=>getCustomer(tx,a,id));
async function conversation(a: ServiceActor, steps: object[]) {
  const fake = new ScriptedServicesModel(steps.map(interpretation)); const secretary = new SalonSecretary(async()=>fake,()=>"fake-customers");
  const session = await secretary.start(a,"customers");
  return { fake, secretary, sessionId: session.sessionId, send: (message: string)=>secretary.send(a,{sessionId:session.sessionId,message}) };
}
suite("Customers — PostgreSQL runtime, no network",()=>{
  const network = vi.fn(()=>{throw new Error("NETWORK_FORBIDDEN");});
  beforeAll(async()=>{
    console.log("CUSTOMERS_DATABASE_PREFLIGHT",await assertMvpTestDatabase(admin));
    const [role] = await prisma.$queryRaw<{ role: string; super: boolean; bypass: boolean }[]>`SELECT current_user AS role,rolsuper AS super,rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({role:"mvp_service_runtime",super:false,bypass:false});
    const [rls] = await admin.$queryRaw<{ enabled: boolean; forced: boolean }[]>`SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE relname='ClientProfile'`;
    expect(rls).toEqual({enabled:true,forced:true});vi.stubGlobal("fetch",network);
    const [grants] = await prisma.$queryRaw<{ auth_read: boolean; auth_write: boolean; delete: boolean; email_update: boolean }[]>`SELECT
      has_column_privilege(current_user,'"ClientProfile"','passwordHash','SELECT') AS auth_read,
      has_column_privilege(current_user,'"ClientProfile"','sessionVersion','UPDATE') AS auth_write,
      has_table_privilege(current_user,'"ClientProfile"','DELETE') AS delete,
      has_column_privilege(current_user,'"ClientProfile"','email','UPDATE') AS email_update`;
    // Gate 2.3 explicitly authorizes internal account detection; DTO tests below still forbid exposure.
    expect(grants).toEqual({auth_read:true,auth_write:false,delete:false,email_update:true});
  });
  afterAll(async()=>{expect(network).not.toHaveBeenCalled();vi.unstubAllGlobals();await admin.$disconnect();await prisma.$disconnect();});
  it("A/B/J: only name required, proposed create writes once, no model on confirm/replay",async()=>{
    const {actor}=await fixture();const c=await conversation(actor,[{name:"Amanda Souza"}]);
    const s=await c.send("Cadastre Amanda Souza");expect(s.customer?.draft?.status).toBe("READY");expect(s.customer?.draft?.missing_fields).toEqual([]);
    expect(await count(actor)).toBe(0);
    const first=await c.secretary.confirm(actor,c.sessionId,confirmInput(s));expect(first.customer?.receipt?.duplicate).toBe(false);expect(await count(actor)).toBe(1);
    const repeated=await c.secretary.confirm(actor,c.sessionId,confirmInput(s));expect(repeated.customer?.receipt).toEqual({...first.customer?.receipt,duplicate:true});expect(await count(actor)).toBe(1);expect(c.fake.requests).toHaveLength(1);
  });
  it("B: complete customer uses domain normalization",async()=>{
    const {actor}=await fixture();const c=await conversation(actor,[{name:"Amanda Souza",phone:"(11) 99999-0011",email:"Amanda@example.test"}]);
    const s=await c.send("Cadastre Amanda Souza, telefone (11) 99999-0011, email Amanda@example.test");expect(await count(actor)).toBe(0);
    const r=await c.secretary.confirm(actor,c.sessionId,confirmInput(s));expect(r.customer?.receipt?.customer).toMatchObject({name:"Amanda Souza",phone:"11999990011",email:"amanda@example.test"});
  });
  it("C/D: phone-only patch and missing email preserve other fields and same draft",async()=>{
    const {actor}=await fixture();const old=await add(actor,{name:"Amanda Souza",phone:"11999990011",email:"before@example.test"});
    const c=await conversation(actor,[{operation:"customer.change",target_name:"Amanda Souza",phone:"11999990022"}]);
    const s=await c.send("Altere o telefone da Amanda Souza para 11999990022");expect(s.customer?.proposal?.patch).toEqual({phone:"11999990022"});expect(await read(actor,old.id)).toEqual(old);
    await c.secretary.confirm(actor,c.sessionId,confirmInput(s));expect(await read(actor,old.id)).toEqual({...old,phone:"11999990022"});
    const d=await conversation(actor,[{operation:"customer.change",target_name:"Amanda Souza",requested_fields:["email"]},{operation:"customer.change",email:"after@example.test"}]);
    const missing=await d.send("Mude o e-mail da Amanda Souza.");expect(missing.customer?.draft?.missing_fields).toEqual(["email"]);expect(missing.customer?.proposal).toBeUndefined();
    const ready=await d.send("after@example.test");expect(ready.customer?.draft?.draft_ref).toBe(missing.customer?.draft?.draft_ref);expect(ready.customer?.proposal?.patch).toEqual({email:"after@example.test"});
    await d.secretary.confirm(actor,d.sessionId,confirmInput(ready));expect(await read(actor,old.id)).toEqual({...old,phone:"11999990022",email:"after@example.test"});
  });
  it("E/F/H: ambiguous selection, absent customer, cross-tenant references and RLS",async()=>{
    const {actor}=await fixture();const foreign=await fixture();const a=await add(actor,{name:"Amanda Souza",phone:"11999990011"});const b=await add(actor,{name:"Amanda Silva",phone:"11999990022"});
    const c=await conversation(actor,[{operation:"customer.change",target_name:"Amanda",phone:"11999990033"}]);const s=await c.send("Altere o telefone da Amanda para 11999990033");expect(s.customer?.candidates).toHaveLength(2);expect(s.customer?.proposal).toBeUndefined();expect(s.customer?.candidates?.[0].phone).toContain("*****");
    await expect(c.secretary.selectCustomer(foreign.actor,c.sessionId,a.id)).rejects.toThrow("SESSION_NOT_FOUND");
    await expect(withTenant(foreign.actor,tx=>getCustomer(tx,foreign.actor,a.id))).rejects.toThrow("CUSTOMER_NOT_FOUND");
    expect(await withTenant(foreign.actor,tx=>searchSalonCustomer(tx,foreign.actor,"Amanda"))).toEqual([]);
    expect(await withTenant(foreign.actor,tx=>tx.clientProfile.count({where:{id:a.id}}))).toBe(0);
    expect(await prisma.clientProfile.count()).toBe(0);
    expect(await withTenant({salonId:"invalid-synthetic-tenant",userId:actor.userId},tx=>tx.clientProfile.count())).toBe(0);
    const selected=await c.secretary.selectCustomer(actor,c.sessionId,b.id);await c.secretary.confirm(actor,c.sessionId,confirmInput(selected));expect(await read(actor,a.id)).toEqual(a);expect((await read(actor,b.id)).phone).toBe("11999990033");expect(c.fake.requests).toHaveLength(1);
    const missing=await conversation(actor,[{operation:"customer.change",target_name:"Inexistente",email:"a@example.test"}]);expect((await missing.send("Mude Inexistente")).customer?.draft).toBeUndefined();expect(await count(actor)).toBe(2);
  });
  it("G: duplicates block creation and explicit choice only reads existing profile",async()=>{
    const {actor}=await fixture();const existing=await add(actor,{name:"Amanda Souza",phone:"11999990011"});const c=await conversation(actor,[{name:"Amanda Souza",phone:"+55 11 99999-0011"}]);
    const s=await c.send("Cadastre Amanda Souza, telefone +55 11 99999-0011");expect(s.customer?.duplicate).toBe(true);expect(s.customer?.proposal).toBeUndefined();
    const selected=await c.secretary.selectCustomer(actor,c.sessionId,existing.id);expect(selected.customer?.customer).toEqual(existing);expect(selected.customer?.proposal).toBeUndefined();expect(await count(actor)).toBe(1);
  });
  it("I: forbidden fields rejected by model contract and deterministic backend",async()=>{
    const {actor}=await fixture();for(const key of ["role","salonId","passwordHash","media_ref","consentGiven"]){
      const c=await conversation(actor,[{name:"Amanda Souza",[key]:"forged"}]);await expect(c.send("forged")).rejects.toThrow("SECRETARY_TURN_FAILED");
      await expect(add(actor,{name:"Amanda Souza",[key]:"forged"})).rejects.toThrow();
    }expect(await count(actor)).toBe(0);
  });
  it("K: changed revision invalidates proposal, including ABA",async()=>{
    const {actor}=await fixture();const old=await add(actor,{name:"Amanda Souza"});const c=await conversation(actor,[{operation:"customer.change",target_name:"Amanda",phone:"11999990011"}]);const s=await c.send("Altere telefone");
    const snap=await withTenant(actor,tx=>customerSnapshot(tx,actor,old.id));await withTenant(actor,tx=>executeCustomerPatch(tx,actor,{name:"Amanda Nova"},{id:old.id,revision:snap.revision}));
    const snap2=await withTenant(actor,tx=>customerSnapshot(tx,actor,old.id));await withTenant(actor,tx=>executeCustomerPatch(tx,actor,{name:"Amanda Souza"},{id:old.id,revision:snap2.revision}));
    await expect(c.secretary.confirm(actor,c.sessionId,confirmInput(s))).rejects.toThrow("CUSTOMER_CHANGED");expect(await read(actor,old.id)).toEqual(old);
  });
  it("read DTO contains only authorized fields; explicit clear, repeated update leaves revision intact",async()=>{
    const {actor}=await fixture();const old=await add(actor,{name:"Amanda Souza",phone:"11999990011",email:"amanda@example.test"});
    const readC=await conversation(actor,[{operation:"customer.read",target_name:"Amanda Souza"}]);const result=await readC.send("Quem é a Amanda Souza?");expect(result.customer?.customer).toEqual(old);expect(Object.keys(result.customer!.customer!).sort()).toEqual(["email","id","name","phone"]);expect(result.customer?.draft).toBeUndefined();
    const c=await conversation(actor,[{operation:"customer.change",target_name:"Amanda",clear_fields:["email"]}]);const s=await c.send("Remova o e-mail da Amanda");expect(s.customer?.proposal?.patch).toEqual({email:null});await c.secretary.confirm(actor,c.sessionId,confirmInput(s));
    const after=await withTenant(actor,tx=>customerSnapshot(tx,actor,old.id));await c.secretary.confirm(actor,c.sessionId,confirmInput(s));expect(await withTenant(actor,tx=>customerSnapshot(tx,actor,old.id))).toEqual(after);expect(after.customer).toEqual({...old,email:null});
  });
  it("read projection is whitelisted and preserves row revision without any customer draft",async()=>{
    const {actor}=await fixture(),foreign=await fixture();const original=await add(actor,{name:"Renata Ribeiro",phone:"11999990011",email:"renata@example.test"});
    const before=await withTenant(actor,tx=>customerSnapshot(tx,actor,original.id));
    for(const requested_fields of [["name","phone","email"],["email"]]){
      const c=await conversation(actor,[{operation:"customer.read",target_name:"Renata Ribeiro",requested_fields}]);const view=await c.send("Consulte os dados da Renata Ribeiro.");
      expect(view.customer?.read_fields).toEqual(requested_fields);expect(view.customer?.requested).toEqual([]);expect(view.customer?.patch).toEqual({});expect(view.customer?.customer).toEqual(original);expect(view.customer?.draft).toBeUndefined();expect(view.customer?.proposal).toBeUndefined();
      expect(Object.keys(view.customer!.customer!).sort()).toEqual(["email","id","name","phone"]);
      if(requested_fields.length===1)expect(view.message).toBe("E-mail: renata@example.test");
    }
    expect(await withTenant(actor,tx=>customerSnapshot(tx,actor,original.id))).toEqual(before);
    expect(await withTenant(actor,tx=>tx.auditLog.count({where:{salonId:actor.salonId,entityType:"SECRETARY_CUSTOMERS"}}))).toBe(0);
    const cross=await conversation(foreign.actor,[{operation:"customer.read",target_name:"Renata Ribeiro",requested_fields:["email"]}]);expect((await cross.send("Consulte o e-mail da Renata Ribeiro.")).customer?.customer).toBeUndefined();
    const bad=await conversation(actor,[{operation:"customer.read",target_name:"Renata Ribeiro",requested_fields:["email"],clear_fields:["email"]}]);await expect(bad.send("Consulte o cadastro.")).rejects.toThrow("SECRETARY_TURN_FAILED");
    expect(await withTenant(actor,tx=>customerSnapshot(tx,actor,original.id))).toEqual(before);
  });
  it("role revalidated: reception allowed for Customers only; revoked role cannot confirm",async()=>{
    const {actor}=await fixture();await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${actor.salonId},true)`;await tx.membership.updateMany({where:actor,data:{role:"RECEPTIONIST"}});});
    const c=await conversation(actor,[{name:"Amanda Souza"}]);const s=await c.send("Cadastre Amanda Souza");await expect(c.secretary.start(actor,"services")).rejects.toThrow("FORBIDDEN");
    await admin.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.current_salon',${actor.salonId},true)`;await tx.membership.updateMany({where:actor,data:{role:"PROFESSIONAL"}});});
    await expect(c.secretary.confirm(actor,c.sessionId,confirmInput(s))).rejects.toThrow("FORBIDDEN");expect(await count(actor)).toBe(0);
  });
  it("same proposal concurrent confirmation executes once; duplicate introduced after proposal is rejected",async()=>{
    const {actor}=await fixture();const c=await conversation(actor,[{name:"Amanda Souza",phone:"11999990011"}]);const s=await c.send("Cadastre Amanda");
    const receipts=await Promise.all([1,2].map(()=>withTenant(actor,tx=>confirmCustomerChange(tx,actor,confirmInput(s)))));expect(receipts.map(x=>x.duplicate).sort()).toEqual([false,true]);expect(await count(actor)).toBe(1);
    const d=await withTenant(actor,tx=>upsertCustomerDraft(tx,actor,{operation:"customer.create",patch:{name:"Outra",phone:"11999990022"}}));
    const p=await withTenant(actor,tx=>proposeCustomerChange(tx,actor,draftRef(d)));await add(actor,{name:"Concorrente",phone:"11999990022"});await expect(withTenant(actor,tx=>confirmCustomerChange(tx,actor,{proposal_ref:p.proposal_ref,draft_revision:p.draft_revision}))).rejects.toThrow("DUPLICATE_CANDIDATE");expect(await count(actor)).toBe(2);
  });
});
function draftRef(d: {draft_ref:string;draft_revision:number}){return {draft_ref:d.draft_ref,draft_revision:d.draft_revision};}
