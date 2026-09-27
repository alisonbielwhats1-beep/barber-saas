import { describe,it,expect } from "vitest";
import { t21Cases,t21Fixture,T21_MAX_REQUESTS,T21_MAX_USD } from "../../../packages/salon-secretary/evaluation/t21-cases";
import { canStartCompleteCase,scoreT21 } from "../../../packages/salon-secretary/evaluation/t21-target";
import { validateSelectionV2 } from "@everflair/salon-secretary";
import { validateFixture } from "../../../packages/salon-secretary/evaluation/hard-conversations-fixtures";
describe("T21 separate gate, no inference",()=>{
  it("contains only new cases and reserves ten complete turns under the fixed budget",()=>{
    expect(t21Cases.map(c=>c.id)).toEqual(["x90","x91","x92","x93","x94"]);
    expect(t21Cases.reduce((n,c)=>n+c.messages.length,0)).toBe(T21_MAX_REQUESTS);expect(T21_MAX_USD).toBe(.13);
    expect(canStartCompleteCase(1,"x91")).toBe(true);expect(canStartCompleteCase(8,"x92")).toBe(false);
    for(const id of ["x41","x42","x44","x46","x49"])expect(()=>canStartCompleteCase(0,id)).toThrow("T21_CASE_FORBIDDEN");
  });
  it.each(t21Cases)("$id fixture and oracle validate independently of the provider",c=>{
    expect(validateFixture(t21Fixture(c))).toEqual([]);expect(validateSelectionV2(c.expected).operations).toHaveLength(c.actions);
    expect(c.checkpoints).toHaveLength(c.messages.length);expect(c.outputs).toHaveLength(c.messages.length-1);
    expect(scoreT21(c,1,null,null).pass).toBe(false);
  });
});
