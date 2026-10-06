import { describe, expect, it } from "vitest";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import type { SchedulingFields } from "../scheduling-contract";

const now = new Date("2026-09-26T12:00:00Z");
const ground = (text: string, patch: SchedulingFields, previous: SchedulingFields = {}, at = now, tz = "America/Sao_Paulo") => groundSchedulingTemporal(previous, patch, text, tz, at);
describe("source temporal grounding before proposal", () => {
  it("preserves explicit original and destination clocks from the manual Amanda report", () => {
    const result = ground("altere a amanda souza das 11h para amanha as 09h", {customer_name:"Amanda Souza",source_time:"11:00",day_offset:1,time:"09:00"});
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({customer_name:"Amanda Souza",source_time:"11:00",date:"2026-09-27",time:"09:00"});
  });
  it("rejects swapped source and destination rather than silently correcting", () => {
    const result = ground("altere a Amanda das 11h para amanhã às 09h", {source_time:"09:00",day_offset:1,time:"11:00"});
    expect(result.rejected.map(r=>r.field).sort()).toEqual(["source_time","time"]);
    expect(result.fields.source_time).toBeUndefined();expect(result.fields.time).toBeUndefined();
  });
  it("does not invent a missing original clock", () => {
    const result=ground("altere a Amanda das 11h para amanhã às 09h",{day_offset:1,time:"09:00"});
    expect(result.rejected).toContainEqual({code:"SOURCE_TEMPORAL_CONFLICT",field:"source_time",value:"MISSING"});
    expect(result.fields.time).toBe("09:00");
  });
  it("grounds an exact pending original time without discarding the destination", () => {
    const previous={customer_name:"Amanda Souza",date:"2026-09-27",time:"09:00"};
    const result=groundSchedulingTemporal(previous,{source_time:"11:00"},"11h","America/Sao_Paulo",now,"source_time");
    expect(result.rejected).toEqual([]);expect(result.fields).toEqual({...previous,source_time:"11:00"});
  });
  it("rejects a model putting the original-time answer in the destination field", () => {
    const result=groundSchedulingTemporal({time:"09:00"},{time:"11:00"},"11h","America/Sao_Paulo",now,"source_time");
    expect(result.rejected.map(r=>r.field)).toEqual(["source_time","time"]);
  });
  it("keeps negation fail-safe for explicit source/destination clocks",()=>{
    expect(ground("não altere a Amanda das 11h para amanhã às 09h",{source_time:"11:00",day_offset:1,time:"09:00"}).rejected.length).toBeGreaterThan(0);
  });
  it.each([
    ["domingo", {weekday:0}, "2026-09-27"],
    ["hoje", {day_offset:0}, "2026-09-26"],
    ["amanhã", {day_offset:1}, "2026-09-27"],
    ["depois de amanhã", {day_offset:2}, "2026-09-28"],
    ["27/09/2026", {date:"2026-09-27"}, "2026-09-27"],
    ["2026-09-27", {date:"2026-09-27"}, "2026-09-27"],
    ["27 de setembro de 2026", {date:"2026-09-27"}, "2026-09-27"],
    ["dia 27", {date:"2026-09-27"}, "2026-09-27"],
    ["domingo dia 27", {date:"2026-09-27"}, "2026-09-27"],
    ["domingo 27/09/2026", {date:"2026-09-27"}, "2026-09-27"],
  ] as const)("accepts matching %s", (text, patch, date) => {
    const result = ground(text, patch); expect(result.rejected).toEqual([]); expect(result.fields.date).toBe(date);
  });
  it.each([
    ["domingo", {weekday:6}], ["segunda", {weekday:2}],
    ["hoje", {day_offset:1}], ["amanhã", {day_offset:2}], ["depois de amanhã", {day_offset:1}],
    ["domingo 03/10/2026", {date:"2026-10-03"}],
    ["dia 27", {date:"2026-09-28"}], ["27/09/2026", {date:"2026-09-28"}],
    ["31/02/2026", {date:"2026-02-28"}],
    ["não no domingo", {weekday:0}], ["não domingo, segunda", {weekday:0}],
  ] as const)("rejects contradiction/negation %s", (text, patch) => {
    const result = ground(text, patch); expect(result.rejected).toContainEqual(expect.objectContaining({code:"SOURCE_TEMPORAL_CONFLICT",field:"date"})); expect(result.fields.date).toBeUndefined();
  });
  it.each([["às dez horas","10:00"],["às 10h","10:00"],["às dez e meia","10:30"],["dez e meia","10:30"],["às dez e trinta","10:30"],["às 10:30","10:30"],["às vinte e duas e meia","22:30"],["às duas da tarde","14:00"]])("grounds explicit %s",(text,time)=>{
    expect(ground(text,{time}).rejected).toEqual([]);
    expect(ground(text,{time:"11:30"}).fields.time).toBeUndefined();
  });
  it("reproduces G without changing entities or replacing Saturday silently",()=>{
    const result=ground("Marca o Fábio para Massagem com a Tatiana A no domingo às dez horas.",{weekday:6,time:"10:00",customer_name:"Fábio",service_name:"Massagem",professional_name:"Tatiana A"});
    expect(result.fields).toEqual({time:"10:00",customer_name:"Fábio",service_name:"Massagem",professional_name:"Tatiana A"});
    expect(result.rejected).toEqual([{code:"SOURCE_TEMPORAL_CONFLICT",field:"date",value:"2026-10-03"}]);
  });
  it("uses salon date across UTC/local midnight",()=>{
    const at=new Date("2026-09-27T01:00:00Z");
    expect(ground("hoje",{date:"2026-09-26"},{},at).rejected).toEqual([]);
    expect(ground("hoje",{date:"2026-09-27"},{},at).fields.date).toBeUndefined();
    expect(ground("hoje",{date:"2026-09-27"},{},at,"UTC").rejected).toEqual([]);
    expect(ground("amanhã",{date:"2026-09-28"},{},new Date("2026-09-27T03:01:00Z")).rejected).toEqual([]);
  });
  it("preserves independent fields and rejects an old value repeated during correction",()=>{
    const previous={date:"2026-10-03",time:"10:00",customer_ref:"c",service_ref:"s",professional_ref:"p"};
    const rejected=ground("Não, domingo.",{weekday:6},previous);
    expect(rejected.fields).toEqual({time:"10:00",customer_ref:"c",service_ref:"s",professional_ref:"p"});
    expect(ground("domingo",{weekday:0},rejected.fields).fields).toEqual({...previous,date:"2026-09-27"});
  });
  it("never assigns multiple source/destination anchors by guessing",()=>{
    expect(ground("muda de domingo às dez para segunda às onze",{source_weekday:0,weekday:1,source_time:"10:00",time:"11:00"}).rejected.length).toBeGreaterThan(0);
  });
  it.each(["domingo","segunda","terça","quarta","quinta","sexta","sábado"])("grounds weekday %s independently of the model",name=>{
    const weekday=["domingo","segunda","terça","quarta","quinta","sexta","sábado"].indexOf(name);
    expect(ground(name,{weekday}).rejected).toEqual([]);
    expect(ground(name,{weekday:(weekday+1)%7}).fields.date).toBeUndefined();
  });
  it("accepts corroborating model selectors and rejects contradictory selectors before persistence",()=>{
    expect(ground("domingo 27/09/2026",{date:"2026-09-27",weekday:0}).rejected).toEqual([]);
    expect(ground("domingo 27/09/2026",{date:"2026-09-27",weekday:6}).fields.date).toBeUndefined();
  });
});
