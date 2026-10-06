import { describe, expect, it } from "vitest";
import { reconcileSchedulingFields as merge, reconcileSchedulingTemporal, schedulingTemporalConflicts as conflicts, matchesSchedulingPeriod, assertSchedulingTemporalConsistency } from "../scheduling-temporal";
import { secretaryFastPath } from "../secretary-fast-path";

describe("Scheduling temporal reconciliation (no model)",()=>{
  it("A: new daypart invalidates incompatible old time, not independent fields",()=>{
    const before={time:"11:00",date:"2026-09-22",customer_ref:"c",service_ref:"s",professional_ref:"p"};
    const after=merge(before,{period:"afternoon"});
    expect(after).toEqual({date:before.date,customer_ref:"c",service_ref:"s",professional_ref:"p",period:"afternoon"});
    expect(before.time).toBe("11:00");expect(conflicts(after)).toEqual([]);
  });
  it("B: compatible constraints remain",()=>{
    expect(merge({time:"14:00"},{period:"afternoon"})).toEqual({time:"14:00",period:"afternoon"});
  });
  it("C: newer concrete time replaces old time and incompatible old daypart",()=>{
    expect(merge({time:"14:00",period:"afternoon"},{time:"11:00"})).toEqual({time:"11:00"});
    expect(merge({time:"14:00",period:"afternoon"},{time:"15:00"})).toEqual({time:"15:00",period:"afternoon"});
  });
  it("D: new date preserves independent references and explicit local time",()=>{
    expect(merge({date:"2026-09-22",time:"11:00",customer_ref:"c",service_ref:"s",professional_ref:"p"},{date:"2026-09-23"}))
      .toEqual({date:"2026-09-23",time:"11:00",customer_ref:"c",service_ref:"s",professional_ref:"p"});
  });
  it.each([{}, {time:"11:00"}])("A/B: received contradictory clock is rejected, never effective (previous=%j)",previous=>{
    const patch={time:"11:00",period:"afternoon" as const};
    const result=reconcileSchedulingTemporal(previous,patch);
    expect(result.fields).toEqual({period:"afternoon"});
    expect(result.rejected).toEqual([{code:"TIME_OUTSIDE_PERIOD",field:"time",value:"11:00"}]);
    expect(conflicts(result.fields)).toEqual([]);expect(patch.time).toBe("11:00");
    expect(()=>assertSchedulingTemporalConsistency(patch)).toThrow("TEMPORAL_CONFLICT");
    expect(merge(result.fields,{time:"14:00"})).toEqual({time:"14:00",period:"afternoon"});
  });
  it.each([["14:00","afternoon"],["11:00","morning"]] as const)("D/E: compatible same patch %s/%s remains effective",(time,period)=>{
    expect(reconcileSchedulingTemporal({},{time,period})).toEqual({fields:{time,period},rejected:[]});
  });
  it("F/G: fast-path unchanged and vague language needs model",()=>{
    expect(secretaryFastPath("time","11h")).toEqual({time:"11:00"});
    expect(secretaryFastPath("time","depois do almoço")).toBeUndefined();
  });
  it.each([
    ["00:00","morning",true],["11:59","morning",true],["12:00","morning",false],
    ["11:59","afternoon",false],["12:00","afternoon",true],["17:59","afternoon",true],
    ["18:00","afternoon",false],["18:00","evening",true],["23:59","evening",true],
  ] as const)("uses existing domain boundary %s/%s",(time,period,match)=>expect(matchesSchedulingPeriod(time,period)).toBe(match));
  it("dependent invalid end is inactive, preserved only in audit evidence",()=>{
    const after=merge({date:"2026-09-22",time:"13:00",end_time:"15:00"},{time:"16:00"});
    expect(after.end_time).toBeUndefined();expect(conflicts(after)).toEqual([]);
    const moved=reconcileSchedulingTemporal({date:"2026-09-22",end_date:"2026-09-22",time:"13:00",end_time:"15:00"},{date:"2026-09-23"});
    expect(moved.fields).toEqual({date:"2026-09-23",time:"13:00"});
    expect(moved.rejected).toEqual([{code:"END_NOT_AFTER_START",field:"end_time",value:"15:00"},{code:"END_NOT_AFTER_START",field:"end_date",value:"2026-09-22"}]);
    expect(conflicts({date:"2026-09-22",time:"23:00",end_time:"00:00"})).toEqual([]);
  });
  it("does not invent provenance/defaults; undefined means omitted; raw relative selectors fail closed",()=>{
    expect(merge({time:"11:00"},{time:undefined})).toEqual({time:"11:00"});
    expect(merge({},{period:"afternoon"})).not.toHaveProperty("time");
    expect(()=>assertSchedulingTemporalConsistency({date:"2026-09-22",day_offset:1})).toThrow("TEMPORAL_CONFLICT");
  });
});
