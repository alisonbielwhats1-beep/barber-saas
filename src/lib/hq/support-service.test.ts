import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const f=vi.hoisted(()=>({scope:vi.fn(),ready:vi.fn(),config:vi.fn(),context:vi.fn(),reserve:vi.fn(),finish:vi.fn(),complete:vi.fn()}));
vi.mock("./access",()=>({withHq:f.scope}));
vi.mock("./chief-config",()=>({chiefConfig:f.config}));
vi.mock("./chief-repository",()=>({chiefReady:f.ready,reserveChief:f.reserve,finishChief:f.finish}));
vi.mock("./support-repository",()=>({supportContext:f.context}));
vi.mock("@everflare/agents/support",()=>({completeSupport:f.complete,SUPPORT_VERSION:"test"}));
import {askSupport,validateSupportDraft} from "./support-service";
import {searchKnowledge} from "./knowledge";
const input={id:"aa000000-0000-4000-8000-000000000001",customerId:"aa000000-0000-4000-8000-000000000002",question:"Como ajustar expediente?"};
const draft={reply:"Confira o expediente e as jornadas.",title:"Horários",category:"Dúvida",recommendation:"reply",needsHuman:false,reason:"Orientação disponível",articleIds:["horarios"]};
let inTx=false;
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("HQ_SUPPORT_ENABLED","true");f.scope.mockImplementation(async(fn)=>{inTx=true;try{return await fn({},"admin");}finally{inTx=false;}});f.config.mockReturnValue({ready:true,apiKey:"synthetic",budgetMicros:2000000});f.ready.mockResolvedValue(true);f.context.mockResolvedValue({accountId:"account",business:"Estúdio",status:"Ativo",tickets:0,activities:0});f.reserve.mockResolvedValue({created:true});f.finish.mockResolvedValue({});f.complete.mockImplementation(async()=>{expect(inTx).toBe(false);return {output:draft,inputTokens:100,outputTokens:20};});});
afterEach(()=>vi.unstubAllEnvs());
describe("Suporte — autorização, fontes e execução",()=>{
 it("nega sem autenticação, flag, cliente válido ou reserva",async()=>{
  f.scope.mockRejectedValueOnce(new Error("redirect"));await expect(askSupport(input)).rejects.toThrow("redirect");
  vi.stubEnv("HQ_SUPPORT_ENABLED","false");expect((await askSupport(input)).ok).toBe(false);vi.stubEnv("HQ_SUPPORT_ENABLED","true");
  expect((await askSupport({...input,customerId:"wrong"})).ok).toBe(false);
  f.context.mockRejectedValueOnce(new Error("not found"));expect((await askSupport(input)).ok).toBe(false);
  f.reserve.mockRejectedValueOnce(new Error("budget"));expect((await askSupport(input)).ok).toBe(false);expect(f.complete).not.toHaveBeenCalled();
 });
 it("reserva no orçamento compartilhado e nunca envia outra conta",async()=>{
  expect((await askSupport(input)).ok).toBe(true);
  expect(f.context).toHaveBeenCalledWith({},input.customerId);
  expect(f.reserve).toHaveBeenCalledWith({},expect.objectContaining({budgetMicros:2000000,contextKey:"support:"+input.customerId,snapshot:expect.objectContaining({kind:"support",customerId:input.customerId})}));
  expect(f.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.complete.mock.invocationCallOrder[0]);
  expect(f.finish).toHaveBeenCalledWith({},input.id,"admin",expect.objectContaining({chargeMicros:49,answer:JSON.stringify(draft)}));
 });
 it("replay não consome novamente e falha conserva reserva",async()=>{
  f.reserve.mockResolvedValueOnce({created:false});expect((await askSupport(input)).ok).toBe(true);expect(f.complete).not.toHaveBeenCalled();
  f.complete.mockRejectedValueOnce(new Error("private-provider-error"));expect(JSON.stringify(await askSupport(input))).not.toContain("private-provider-error");expect(f.finish).toHaveBeenCalledWith({},input.id,"admin",null);
 });
 it("exige humano sem conhecimento, com fontes inventadas e em assuntos comerciais",()=>{
  expect(searchKnowledge("equipamento ultrassônico XYZ")).toEqual([]);
  expect(validateSupportDraft(draft,[])).toMatchObject({needsHuman:true,recommendation:"human",articleIds:[]});
  expect(validateSupportDraft({...draft,articleIds:["inventado"]},searchKnowledge("expediente"))).toMatchObject({needsHuman:true,recommendation:"human"});
  expect(validateSupportDraft({...draft,articleIds:["comercial"]},searchKnowledge("mensalidade plano"))).toMatchObject({needsHuman:true,recommendation:"human"});
  expect(()=>validateSupportDraft({...draft,reply:"x".repeat(1801)},searchKnowledge("expediente"))).toThrow();
 });
});
