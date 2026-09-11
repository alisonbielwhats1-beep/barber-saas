import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const f=vi.hoisted(()=>({scope:vi.fn(),config:vi.fn(),ready:vi.fn(),snapshot:vi.fn(),reserve:vi.fn(),finish:vi.fn(),complete:vi.fn()}));
vi.mock("./access",()=>({withHq:f.scope}));
vi.mock("./chief-config",()=>({chiefConfig:f.config}));
vi.mock("./chief-snapshot",()=>({chiefSnapshot:f.snapshot,chiefSources:[]}));
vi.mock("./chief-repository",()=>({chiefReady:f.ready,reserveChief:f.reserve,finishChief:f.finish}));
vi.mock("@everflare/agents/chief",()=>({completeChief:f.complete,estimateChiefMicros:()=>100}));
import {askChief} from "./chief-service";
let inTransaction=false;
const input={id:"aa000000-0000-4000-8000-000000000001",question:"Como está o HQ?"};
beforeEach(()=>{
 vi.clearAllMocks();
 f.scope.mockImplementation(async(fn)=>{inTransaction=true;try{return await fn({},"admin");}finally{inTransaction=false;}});
 f.config.mockReturnValue({ready:true,apiKey:"synthetic",budgetMicros:5000000});
 f.ready.mockResolvedValue(true);f.snapshot.mockResolvedValue({tickets:2});
 f.reserve.mockResolvedValue({created:true,run:{id:input.id}});
 f.finish.mockResolvedValue({id:input.id,status:"completed"});
 f.complete.mockImplementation(async()=>{expect(inTransaction).toBe(false);return {output:"Resumo",inputTokens:10,outputTokens:5};});
});
describe("Chefe — autorização e orquestração",()=>{
 it("nega antes de consultar dados ou consumir IA",async()=>{
  f.scope.mockRejectedValueOnce(new Error("redirect"));
  await expect(askChief(input)).rejects.toThrow("redirect");
  expect(f.snapshot).not.toHaveBeenCalled();expect(f.complete).not.toHaveBeenCalled();
 });
 it("não executa sem chave/ativação, com dados inválidos, schema ausente ou orçamento negado",async()=>{
  f.config.mockReturnValueOnce({ready:false,reason:"desativado"});
  expect(await askChief(input)).toEqual({ok:false,error:"desativado"});
  expect((await askChief({...input,question:"x"})).ok).toBe(false);
  f.ready.mockResolvedValueOnce(false);expect((await askChief(input)).ok).toBe(false);
  f.reserve.mockRejectedValueOnce(new Error("budget"));expect((await askChief(input)).ok).toBe(false);
  expect(f.complete).not.toHaveBeenCalled();
 });
 it("reserva antes da chamada, fecha transação e persiste a resposta",async()=>{
  expect((await askChief(input)).ok).toBe(true);
  expect(f.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.complete.mock.invocationCallOrder[0]);
  expect(f.finish).toHaveBeenCalledWith({},input.id,"admin",{answer:"Resumo",inputTokens:10,outputTokens:5,chargeMicros:100});
 });
 it("replay não chama provedor e falha conserva reserva",async()=>{
  f.reserve.mockResolvedValueOnce({created:false,run:{id:input.id,status:"running"}});
  expect((await askChief(input)).ok).toBe(true);expect(f.complete).not.toHaveBeenCalled();
  f.complete.mockRejectedValueOnce(new Error("secret-error-must-not-leak"));
  const result=await askChief(input);
  expect(f.finish).toHaveBeenLastCalledWith({},input.id,"admin",null);
  expect(JSON.stringify(result)).not.toContain("secret-error");
 });
});
