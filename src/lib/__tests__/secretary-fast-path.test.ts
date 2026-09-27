import { describe,it,expect } from "vitest";
import { secretaryFastPath } from "../secretary-fast-path";
import { resolveSchedulingDate,schedulingPatch } from "../scheduling-contract";
import { serviceMvpPatch } from "../service-contract";
describe("conservative pending-field fast-path",()=>{
  it.each([["11h","11:00"],["09:45","09:45"],["11h15","11:15"]])("accepts exact time %s",(text,time)=>expect(secretaryFastPath("time",text)).toEqual({time}));
  it.each(["depois do almoço","mais tarde","no fim da tarde","umas onze e pouco","11","11h e amanhã","25h","11:70","11h, cancele Amanda"])("falls back without guessing: %s",text=>expect(secretaryFastPath("time",text)).toBeUndefined());
  it("requires explicit waiting state and validates backend boundaries",()=>{
    expect(secretaryFastPath(undefined,"11h")).toBeUndefined();expect(secretaryFastPath("customer_ref","11h")).toBeUndefined();
    expect(secretaryFastPath("durationMin","45 minutos")).toEqual({durationMin:45});
    expect(()=>serviceMvpPatch.parse(secretaryFastPath("durationMin","999 minutos"))).toThrow();
    expect(schedulingPatch.parse(secretaryFastPath("end_time","15h"))).toEqual({end_time:"15:00"});
  });
  it("tomorrow uses authorized timezone and origin/destination remain distinct",()=>{
    const now=new Date("2026-01-02T01:00:00Z");
    expect(resolveSchedulingDate(schedulingPatch.parse(secretaryFastPath("date","amanhã")),"America/Sao_Paulo",now).date).toBe("2026-01-02");
    expect(resolveSchedulingDate({source_day_offset:1,source_time:"10:00",time:"11:00"},"America/Sao_Paulo",now)).toEqual({source_date:"2026-01-02",source_time:"10:00",time:"11:00"});
  });
});
