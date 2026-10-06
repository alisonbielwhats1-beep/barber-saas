import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { searchProducts, getProduct, getStockBalance } from "../inventory-catalog";
import { upsertInventoryDraft, proposeStockMovement, confirmStockMovement } from "../inventory-actions";
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";

const suite=process.env.RUN_SERVICE_MVP_INTEGRATION==="1"?describe:describe.skip;
const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL??process.env.DATABASE_URL}}});
const observedSql:string[]=[];
const observer=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}},log:[{emit:"event",level:"query"}]});
observer.$on("query",e=>observedSql.push(e.query)); // SQL only: never params, secrets or customer content.
async function fixture(label:string){
  const salonId=randomUUID();
  return admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner=await tx.user.create({data:{name:`Inventory ${label}`,email:`inventory-${salonId}@local.test`,passwordHash:"non-authenticable-synthetic"}});
    const staff=await tx.user.create({data:{name:"Synthetic receptionist",email:`inventory-staff-${salonId}@local.test`,passwordHash:"non-authenticable-synthetic"}});
    await tx.salon.create({data:{id:salonId,slug:`inventory-${salonId}`,name:`Synthetic Inventory ${label}`,accessStatus:"APPROVED",plan:label==="FREE"?"FREE":"PRO",timezone:"America/Sao_Paulo",currency:"BRL"}});
    await tx.membership.createMany({data:[{salonId,userId:owner.id,role:"OWNER"},{salonId,userId:staff.id,role:"RECEPTIONIST"}]});
    const products=[];
    for(const [name,stock,minStock,active] of [["Shampoo X",12,3,true],["Shampoo Y",0,0,true],["Condicionador",2,5,true],["Produto pausado",1,2,false]] as const){
      products.push(await tx.product.create({data:{salonId,name,stock,minStock,active,priceCents:1000,costCents:333}}));
    }
    return {actor:{salonId,userId:owner.id},staff:{salonId,userId:staff.id},users:[owner.id,staff.id],products};
  });
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
suite("Inventory Core — disposable PostgreSQL runtime",()=>{
  let a:Fixture,b:Fixture,free:Fixture;
  const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});
  const scoped=<T>(fn:Parameters<typeof withTenant<T>>[1])=>withTenant(a.actor,fn);
  const balance=(id=a.products[0].id)=>scoped(tx=>getStockBalance(tx,a.actor,id));
  const prepare=async(mode:"IN"|"OUT",quantity:number,id=a.products[0].id)=>{
    const d=await scoped(tx=>upsertInventoryDraft(tx,a.actor,{product_ref:id,patch:{mode,quantity}}));
    return scoped(tx=>proposeStockMovement(tx,a.actor,{draft_ref:d.draft_ref,draft_revision:d.draft_revision}));
  };
  const confirm=(p:{proposal_ref:string;draft_revision:number})=>scoped(tx=>confirmStockMovement(tx,a.actor,{proposal_ref:p.proposal_ref,draft_revision:p.draft_revision}));
  beforeAll(async()=>{
    expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");
    expect(new URL(process.env.DATABASE_URL!).username).toBe("mvp_service_runtime");
    console.log("INVENTORY_PREFLIGHT",await assertMvpTestDatabase(admin));
    vi.stubGlobal("fetch",network);a=await fixture("A");b=await fixture("B");free=await fixture("FREE");
  });
  afterAll(async()=>{
    expect(network).not.toHaveBeenCalled();
    for(const f of [a,b,free].filter(Boolean))await admin.$transaction(async tx=>{
      await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
      await tx.salon.delete({where:{id:f.actor.salonId}});await tx.user.deleteMany({where:{id:{in:f.users}}});
    });
    vi.unstubAllGlobals();await admin.$disconnect();await observer.$disconnect();await prisma.$disconnect();
  });
  it("exact Product column privileges; RLS/FORCE and tenant policy; no bypass",async()=>{
    expect(await prisma.$queryRaw`SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`).toEqual([{current_user:"mvp_service_runtime",rolsuper:false,rolbypassrls:false}]);
    expect(await prisma.$queryRaw`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='"Product"'::regclass`).toEqual([{relrowsecurity:true,relforcerowsecurity:true}]);
    const grants=await prisma.$queryRaw<{column_name:string;privilege_type:string}[]>`SELECT column_name,privilege_type FROM information_schema.column_privileges WHERE grantee=current_user AND table_name='Product'`;
    expect(grants.filter(g=>g.privilege_type==="SELECT").map(g=>g.column_name).sort()).toEqual(["id","salonId","name","stock","minStock","active","updatedAt"].sort());
    expect(grants.filter(g=>g.privilege_type==="UPDATE").map(g=>g.column_name).sort()).toEqual(["stock","updatedAt"]);
    expect(await prisma.$queryRaw`SELECT has_table_privilege(current_user,'"Product"','SELECT') AS read_all,has_table_privilege(current_user,'"Product"','UPDATE') AS update_all,has_table_privilege(current_user,'"Product"','INSERT') AS ins,has_table_privilege(current_user,'"Product"','DELETE') AS del`).toEqual([{read_all:false,update_all:false,ins:false,del:false}]);
    expect(grants.every(g=>["SELECT","UPDATE"].includes(g.privilege_type))).toBe(true);
    const policies=await prisma.$queryRaw<{policyname:string;qual:string;with_check:string}[]>`SELECT policyname,qual,with_check FROM pg_policies WHERE tablename='Product'`;
    expect(policies).toHaveLength(1);expect(policies[0]).toMatchObject({policyname:"tenant_isolation"});expect(policies[0].qual).toContain("app_current_salon()");expect(policies[0].with_check).toContain("app_current_salon()");
    await expect(scoped(tx=>tx.$queryRaw`SELECT "costCents" FROM "Product"`)).rejects.toThrow(/permission denied/);
  });
  it("A/B/D/E: real balance, missing product, zero and low stock match catalog including inactive",async()=>{
    expect(await balance()).toMatchObject({name:"Shampoo X",stock:12,unit:"un"});
    expect(await balance(a.products[1].id)).toMatchObject({stock:0});
    await expect(balance("missing")).rejects.toThrow("PRODUCT_NOT_FOUND");
    const low=await scoped(tx=>searchProducts(tx,a.actor,{low_stock:true}));expect(low.map(p=>p.name)).toEqual(["Condicionador","Produto pausado","Shampoo Y"]);
    expect(Object.keys(low[0]).sort()).toEqual(["id","name","stock","minStock","active","unit","revision"].sort());
    expect(await scoped(tx=>searchProducts(tx,a.actor,{query:"inexistente"}))).toEqual([]);
  });
  it("F/G/L: approved executor only on confirmation; repeat same receipt, no second stock event",async()=>{
    for(const [mode,quantity,before,after] of [["IN",10,12,22],["OUT",3,22,19]] as const){
      const p=await prepare(mode,quantity);expect(p.projected_stock).toBe(after);expect((await balance()).stock).toBe(before);
      const r=await confirm(p);expect(r).toMatchObject({previous_stock:before,stock:after,duplicate:false});
      expect(await confirm(p)).toEqual({...r,duplicate:true});expect((await balance()).stock).toBe(after);
    }
    const events=await scoped(tx=>tx.auditLog.findMany({where:{salonId:a.actor.salonId,entityType:"Product",entityId:a.products[0].id,action:"STOCK_ADJUSTED"}}));
    expect(events).toHaveLength(2);expect(events.map(e=>(e.metadata as {delta:number}).delta)).toEqual([10,-3]);
  });
  it("J: excess, negative, fractional, null, forbidden COUNT and arbitrary fields never move stock",async()=>{
    const before=await balance();
    for(const patch of [{mode:"OUT",quantity:before.stock+1},{mode:"IN",quantity:-1},{mode:"IN",quantity:1.5},{mode:"COUNT",quantity:10},{quantity:null},{quantity:10,stock:100}]){
      await expect(scoped(tx=>upsertInventoryDraft(tx,a.actor,{product_ref:before.id,patch}))).rejects.toThrow();
    }
    expect(await balance()).toEqual(before);
  });
  it("K: later movement invalidates snapshot even if original proposed balance would fit",async()=>{
    const stale=await prepare("OUT",4),other=await prepare("OUT",3);await confirm(other);
    const before=await balance();await expect(confirm(stale)).rejects.toThrow("PRODUCT_CHANGED");expect(await balance()).toEqual(before);
  });
  it("M: concurrent proposals serialize against the real inventory lock; only one wins",async()=>{
    const p=await prepare("OUT",2),q=await prepare("OUT",2),before=(await balance()).stock;
    const results=await Promise.allSettled([confirm(p),confirm(q)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect((await balance()).stock).toBe(before-2);
  });
  it("M/L: two concurrent confirmations of the SAME proposal share receipt and one effect",async()=>{
    const p=await prepare("IN",1),before=(await balance()).stock;
    const results=await Promise.all([confirm(p),confirm(p)]);
    expect(results.map(r=>r.duplicate).sort()).toEqual([false,true]);expect(results[0].receipt_ref).toBe(results[1].receipt_ref);expect((await balance()).stock).toBe(before+1);
  });
  it("N: positive A/B RLS, no/invalid context, foreign direct reference/proposal denied",async()=>{
    const raw=(f:Fixture)=>withTenant(f.actor,tx=>tx.$queryRaw<{id:string}[]>`SELECT id FROM "Product"`);
    const ar=await raw(a),br=await raw(b);expect(ar.map(p=>p.id).sort()).toEqual(a.products.map(p=>p.id).sort());expect(br.map(p=>p.id).sort()).toEqual(b.products.map(p=>p.id).sort());
    expect(await prisma.$queryRaw`SELECT id FROM "Product"`).toEqual([]);
    expect(await scoped(tx=>tx.product.updateMany({where:{id:b.products[0].id},data:{stock:{increment:1}}}))).toEqual({count:0});
    expect(await withTenant({salonId:"invalid",userId:a.actor.userId},tx=>tx.$queryRaw`SELECT id FROM "Product"`)).toEqual([]);
    await expect(balance(b.products[0].id)).rejects.toThrow("PRODUCT_NOT_FOUND");
    const p=await prepare("IN",1);await expect(withTenant(b.actor,tx=>confirmStockMovement(tx,b.actor,{proposal_ref:p.proposal_ref,draft_revision:p.draft_revision}))).rejects.toThrow("PROPOSAL_NOT_FOUND");
    await expect(withTenant({...b.actor,userId:a.actor.userId},tx=>getProduct(tx,{...b.actor,userId:a.actor.userId},b.products[0].id))).rejects.toThrow("FORBIDDEN");
  });
  it("O: receptionist denied; FREE can read but cannot move, preserving real entitlement",async()=>{
    await expect(withTenant(a.staff,tx=>searchProducts(tx,a.staff,{}))).rejects.toThrow("FORBIDDEN");
    expect((await withTenant(free.actor,tx=>getProduct(tx,free.actor,free.products[0].id))).stock).toBe(12);
    await expect(withTenant(free.actor,tx=>upsertInventoryDraft(tx,free.actor,{product_ref:free.products[0].id,patch:{mode:"IN",quantity:1}}))).rejects.toThrow(/plano Fundador/);
  });
  it("C: ambiguity selection uses real candidates and ZERO second inference",async()=>{
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("stock.movement",{inventory:{product_name:"Shampoo",mode:"IN",quantity:1}})]))]);
    const secretary=new SalonSecretary(async()=>fake,()=>"fake-inventory"),session=await secretary.start(a.actor,"auto");
    const first=await secretary.send(a.actor,{sessionId:session.sessionId,message:"Dê entrada em um shampoo."});
    const op=first.operations![0];expect(op.state.inventory?.candidates).toHaveLength(2);expect(op.state.inventory?.proposal).toBeUndefined();
    await expect(secretary.selectAutomatic(a.actor,session.sessionId,op.operation_ref,b.products[0].id)).rejects.toThrow("SELECTION_INVALID");
    const next=await secretary.selectAutomatic(a.actor,session.sessionId,op.operation_ref,a.products[0].id);
    expect(next.operations![0].state.inventory?.proposal?.product.id).toBe(a.products[0].id);expect(fake.requests).toHaveLength(1);
  });
  it("H/I/R: missing quantity same draft, numeric fast-path zero model, confirmation zero model",async()=>{
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("stock.movement",{inventory:{product_name:"Shampoo X",mode:"IN"}})]))]);
    const factory=vi.fn(async()=>fake),secretary=new SalonSecretary(factory,()=>"fake-inventory"),session=await secretary.start(a.actor,"auto");
    const before=(await balance()).stock;
    const first=await secretary.send(a.actor,{sessionId:session.sessionId,message:"Dê entrada no Shampoo X."});
    const op=first.operations![0];expect(op.state.inventory?.message).toBe("Quantas unidades?");expect(op.state.inventory?.draft?.missing_fields).toEqual(["quantity"]);
    const next=await secretary.send(a.actor,{sessionId:session.sessionId,message:"10"});const c=next.operations![0].state.inventory!;
    expect(c.draft?.draft_ref).toBe(op.state.inventory?.draft?.draft_ref);expect(c.fields).toMatchObject({mode:"IN",quantity:10});expect(c.interpretation_source).toBe("DETERMINISTIC_FAST_PATH");
    expect(c.proposal?.projected_stock).toBe(before+10);expect((await balance()).stock).toBe(before);expect(factory).toHaveBeenCalledTimes(1);
    const done=await secretary.confirmAutomatic(a.actor,session.sessionId,op.operation_ref,{proposal_ref:c.proposal!.proposal_ref,draft_revision:c.proposal!.draft_revision});
    expect(done.operations![0].state.inventory?.receipt?.stock).toBe(before+10);expect(factory).toHaveBeenCalledTimes(1);expect(fake.requests).toHaveLength(1);
    expect(next.loaded?.map(x=>x.skill_id)).toEqual(["inventory"]);
    process.stdout.write(`INVENTORY_FAST_PATH_METRICS ${JSON.stringify(c.metrics)}\n`);
  });
  it("ambiguous quantity falls back to fake; measured model vs deterministic continuation",async()=>{
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("stock.movement",{inventory:{product_name:"Shampoo X",mode:"OUT"}})])),call("upsert_action_draft",{quantity:3})]);
    const secretary=new SalonSecretary(async()=>fake,()=>"fake-inventory"),session=await secretary.start(a.actor,"auto");
    const first=await secretary.send(a.actor,{sessionId:session.sessionId,message:"Dê baixa no Shampoo X."});
    const next=await secretary.send(a.actor,{sessionId:session.sessionId,message:"três unidades"});
    expect(next.operations![0].state.inventory?.draft?.draft_ref).toBe(first.operations![0].state.inventory?.draft?.draft_ref);
    expect(next.operations![0].state.inventory?.interpretation_source).toBe("MODEL");expect(fake.requests).toHaveLength(2);
    process.stdout.write(`INVENTORY_FAKE_MODEL_METRICS ${JSON.stringify(next.operations![0].state.inventory?.metrics)}\n`);
  });
  it("P: Financial read + Inventory proposal, independent refs, one fake interpretation, no stock write",async()=>{
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("financial.report",{financial:{period:"yesterday"}}),intent("stock.movement",{inventory:{product_name:"Shampoo X",mode:"IN",quantity:10}})]))]);
    const secretary=new SalonSecretary(async()=>fake,()=>"fake-inventory"),session=await secretary.start(a.actor,"auto"),before=await balance();
    const result=await secretary.send(a.actor,{sessionId:session.sessionId,message:"Quanto faturei ontem e dê entrada em 10 Shampoo X."});
    expect(result.loaded?.map(s=>s.skill_id)).toEqual(["financial","inventory"]);
    const [fin,inv]=result.operations!;expect(fin.state.financial?.status).toBe("DONE");expect(inv.state.inventory?.proposal).toBeDefined();expect(fin.operation_ref).not.toBe(inv.operation_ref);expect(fake.requests).toHaveLength(1);expect(await balance()).toEqual(before);
  });
  it("new draft revision invalidates former proposal; no stale confirmation",async()=>{
    const p=await prepare("IN",1);
    await scoped(tx=>upsertInventoryDraft(tx,a.actor,{product_ref:p.product.id,draft_ref:p.draft_ref,expected_revision:p.draft_revision,patch:{quantity:2}}));
    await expect(confirm(p)).rejects.toThrow("REVISION_CONFLICT");
  });
  it("Prisma executor touches ONLY authorized Product columns, inactive manual adjustment preserved",async()=>{
    const p=await prepare("IN",1,a.products[3].id);
    await observer.$transaction(async tx=>{
      await tx.$executeRaw`SELECT set_config('app.current_salon',${a.actor.salonId},true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_id',${a.actor.userId},true)`;
      await confirmStockMovement(tx,a.actor,{proposal_ref:p.proposal_ref,draft_revision:p.draft_revision});
    });
    const updates=observedSql.filter(q=>q.startsWith('UPDATE "public"."Product"'));
    expect(updates).toHaveLength(1);expect(updates[0]).toContain('SET "stock" =');expect(updates[0]).toContain('"updatedAt" =');
    for(const forbidden of ["costCents","priceCents","description","imageUrl"])expect(observedSql.filter(q=>q.includes('"Product"')).join()).not.toContain(forbidden);
    process.stdout.write(`INVENTORY_PRODUCT_UPDATE_SQL ${updates[0]}\n`);expect((await balance(a.products[3].id))).toMatchObject({active:false,stock:2});
  });
});
