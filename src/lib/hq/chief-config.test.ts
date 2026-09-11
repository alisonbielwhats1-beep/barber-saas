import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {chiefConfig} from "./chief-config";
describe("configuração do piloto",()=>{
 it("falha fechada e limita configuração de orçamento",()=>{
  expect(chiefConfig({}).ready).toBe(false);
  for(const value of ["0","-1","21","NaN","Infinity",""]){
   expect(chiefConfig({HQ_CHIEF_ENABLED:"true",OPENAI_API_KEY:"fake",HQ_CHIEF_MONTHLY_USD:value}).ready).toBe(false);
  }
  expect(chiefConfig({HQ_CHIEF_ENABLED:"true",HQ_CHIEF_MONTHLY_USD:"5"}).ready).toBe(false);
  expect(chiefConfig({HQ_CHIEF_ENABLED:"true",HQ_CHIEF_MONTHLY_USD:"5",OPENAI_API_KEY:"fake"}).budgetMicros).toBe(5000000);
 });
});
