import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseValues, normalizedTitle, today } from "./validation";
import { definition } from "./catalog";
vi.mock("server-only",()=>({}));
const getAdmin=vi.hoisted(()=>vi.fn());
const withUser=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/platform-admin",()=>({getPlatformAdminContext:getAdmin}));
vi.mock("@/lib/prisma-tenant",()=>({withUser}));
import { withHq } from "./access";

describe("HQ authorization and input contracts",()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("HQ_ENABLED","true");});
 it("autoriza novamente o papel persistido antes de executar a operação",async()=>{
  getAdmin.mockResolvedValue({userId:"owner"});
  const tx={user:{findUnique:vi.fn().mockResolvedValue({platformRole:"USER"})},$executeRaw:vi.fn()};
  withUser.mockImplementation((_id,fn)=>fn(tx));
  const action=vi.fn();
  await expect(withHq(action)).rejects.toThrow("restrito");
  expect(action).not.toHaveBeenCalled();expect(tx.$executeRaw).not.toHaveBeenCalled();
 });
 it("bloqueia HQ desativado antes de abrir transação",async()=>{
  vi.stubEnv("HQ_ENABLED","false");getAdmin.mockResolvedValue({userId:"owner"});
  await expect(withHq(vi.fn())).rejects.toThrow("ativação");expect(withUser).not.toHaveBeenCalled();
 });
 it("não aceita ausência de sessão",async()=>{
  getAdmin.mockRejectedValue(new Error("redirect-login"));
  await expect(withHq(vi.fn())).rejects.toThrow("redirect-login");expect(withUser).not.toHaveBeenCalled();
 });
 it("não aceita campos extras, valores negativos ou status forjados",()=>{
  expect(()=>parseValues("payments",{admin:true})).toThrow();
  expect(()=>parseValues("accounts",{name:"A",business:"B",risk:"SUPER_ADMIN",priority:"Baixa"})).toThrow();
  expect(()=>parseValues("payments",{subscriptionId:crypto.randomUUID(),reference:"2026-09",dueDate:"2026-09-01",amountCents:-1,status:"Pendente"})).toThrow();
 });
 it("valida datas reais e interpreta horário de Brasília",()=>{
  const values={accountId:crypto.randomUUID(),title:"Ligar",status:"Pendente",dueAt:"2026-09-10T10:00"};
  expect(parseValues("followups",values).dueAt).toBe("2026-09-10T13:00:00.000Z");
  expect(()=>parseValues("payments",{subscriptionId:crypto.randomUUID(),reference:"2026-09",dueDate:"2026-02-30",amountCents:100,status:"Pendente"})).toThrow();
  expect(today(new Date("2026-09-11T01:00:00Z"))).toBe("2026-09-10");
 });
 it("normaliza títulos sem acentos e não permite nomes SQL arbitrários",()=>{
  expect(normalizedTitle(" Comissão  automática! ")).toBe("comissao automatica");
  expect(()=>definition('accounts; DROP TABLE "User"')).toThrow();
  expect(()=>definition("__proto__")).toThrow();
 });
});

