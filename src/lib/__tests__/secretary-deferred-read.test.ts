import { afterEach, expect, it, vi } from "vitest";
import { createActionPlan, type PlanAction } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import { prepareDeferredReadFields } from "../secretary-deferred-read";

const db = vi.hoisted(() => ({ timezone: vi.fn(async () => "America/Sao_Paulo") }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, run: (tx: object) => unknown) => run({}) }));
vi.mock("../scheduling-catalog", () => ({ schedulingTimezone: db.timezone }));
const actor = {salonId:"tenant-test", userId:"owner-test"};
const action = () => createActionPlan(plan([intent("appointment.list", {item_key:"agenda"})])).actions[0];
const now = new Date("2026-09-27T02:59:00Z");
afterEach(() => vi.clearAllMocks());

it("grounds relative date once in salon timezone and removes per-turn metadata", async () => {
  const initial = {...action(), fields:{...action().fields,day_offset:1}};
  const result = await prepareDeferredReadFields(actor, initial, {day_offset:1, temporal_evidence:[{field:"date", text:"amanhã"}]}, "Depois mostre a agenda de amanhã.", undefined, now);
  expect(result.fields.date).toBe("2026-09-27"); expect(result.fields.day_offset).toBeUndefined();
  expect(result.fields.temporal_evidence).toBeUndefined(); expect(result.rejected).toEqual([]);
  const later = await prepareDeferredReadFields(actor, {...action(), fields:result.fields}, {professional_name:"Joana"}, "Com a Joana.", undefined, new Date("2026-09-27T03:01:00Z"));
  expect(later.fields).toMatchObject({date:"2026-09-27", professional_name:"Joana"});
});

it("drops a contradicted date without losing other accepted fields", async () => {
  const current = {...action(), fields:{...action().fields, date:"2026-09-27", professional_name:"Joana"}};
  const result = await prepareDeferredReadFields(actor, current, {weekday:6, temporal_evidence:[{field:"date",text:"domingo"}]}, "Quero domingo.", undefined, now);
  expect(result.fields.date).toBeUndefined(); expect(result.fields.professional_name).toBe("Joana");
  expect(result.missing).toEqual(["date"]); expect(result.fields.weekday).toBeUndefined();
});

it("does not retain prior source evidence during a different field correction", async () => {
  const current = {...action(), fields:{...action().fields, date:"2026-09-27",temporal_evidence:[{field:"date",text:"amanhã"}]}} as PlanAction;
  const result = await prepareDeferredReadFields(actor,current,{professional_name:"Ana"},"Com a Ana.",undefined,now);
  expect(result.fields.date).toBe("2026-09-27"); expect(result.fields.temporal_evidence).toBeUndefined();
});

it("reconciles incompatible clocks and periods before a deferred read can be ready", async () => {
  const result=await prepareDeferredReadFields(actor,action(),{date:"2026-09-27",time:"09:00",period:"afternoon"},"Amanhã às 9h.",undefined,now);
  expect(result.fields.time).toBeUndefined();expect(result.missing).toContain("time");
});


it("does not treat initial untrusted absolute fields as an accepted baseline",async()=>{
  const first={...action(),fields:{}} as PlanAction;
  const result=await prepareDeferredReadFields(actor,first,{date:"2026-10-03",time:"11:00"},"Domingo às 10h",undefined,now);
  expect(result.fields.date).toBeUndefined();expect(result.fields.time).toBeUndefined();
});
it("preserves accepted nested financial fields while correcting its period",async()=>{
  const financial=createActionPlan(plan([intent("financial.report",{item_key:"report",financial:{metrics:["service_revenue"],period:"today"}})])).actions[0];
  const result=await prepareDeferredReadFields(actor,financial,{financial:{period:"yesterday",metrics:null}},"Ontem.");
  expect(result.fields.financial).toEqual({metrics:["service_revenue"],period:"yesterday"});expect(db.timezone).not.toHaveBeenCalled();
});


