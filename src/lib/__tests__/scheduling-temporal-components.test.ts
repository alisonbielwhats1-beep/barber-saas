import { describe, expect, it } from "vitest";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import { clockComponents, relativeDayComponents } from "../scheduling-temporal-components";
import { addCalendarDays } from "../time";
import type { SchedulingFields } from "../scheduling-contract";
type Evidence={field:"date"|"time"|"end_time"|"source_time";text:string}[];
const now=new Date("2028-06-12T12:00:00Z");
const ground=(source:string,raw:SchedulingFields,evidence:Evidence,operation="appointment.create")=>
  groundSchedulingTemporal({},raw,source,"America/Sao_Paulo",now,undefined,operation,evidence);

describe("temporal component arithmetic, independent of operation phrasing",()=>{
  it.each([["zero",0],["um",1],["dois",2],["três",3],["sete",7],["trinta e um",31],["sessenta e cinco",65],["trezentos e sessenta e cinco",365]])("grounds an exact day displacement %s",(word,days)=>{
    const text=`daqui a ${word} dias`;
    const result=ground(`Disponibilidade ${text}.`,{day_offset:days as number},[{field:"date",text}]);
    expect(result.rejected).toEqual([]);
    expect(result.fields.date).toBe(addCalendarDays("2028-06-12",days as number));
    expect(ground(text,{day_offset:(days as number)+1},[{field:"date",text}]).fields.date).toBeUndefined();
  });
  it.each([["em 3 dias",3],["dentro de 7 dias",7],["em duas semanas",14],["daqui a uma semana",7]])("keeps unit arithmetic in %s",(text,days)=>{
    expect(ground(text as string,{day_offset:days as number},[{field:"date",text:text as string}]).rejected).toEqual([]);
  });
  it.each(["daqui a 366 dias","daqui a 3 horas","em três semanas","em 3 dias atrás","daqui a menos de 3 dias","daqui a -3 dias","daqui a 3,5 dias","daqui a três e quatro dias"])("cannot certify day_offset3 from %s",text=>{
    expect(ground(text,{day_offset:3},[{field:"date",text}]).fields.date).toBeUndefined();
  });
  it.each([
    ["daqui a três dias","três dias"],
    ["daqui a três dias, sexta-feira","daqui a três dias"],
    ["sexta-feira, daqui a três dias","daqui a três dias"],
  ])("does not certify a clipped displacement %s",(source,text)=>{
    expect(ground(source,{day_offset:3},[{field:"date",text}]).fields.date).toBeUndefined();
  });
  it("checks adjacent weekday against relative calendar arithmetic",()=>{
    const text="daqui a três dias, sexta-feira";
    expect(ground(text,{day_offset:3},[{field:"date",text}]).fields.date).toBeUndefined();
  });
  it("uses local calendar rollover for relative counts",()=>{
    const source="daqui a três dias",at=new Date("2028-12-31T01:00:00Z");
    const result=groundSchedulingTemporal({},{day_offset:3},source,"America/Sao_Paulo",at,undefined,"appointment.create",[{field:"date",text:source}]);
    expect(result.fields.date).toBe("2029-01-02");
  });
  it.each([["meio-dia","12:00"],["meia-noite","00:00"],["meio-dia e meia","12:30"],["meia-noite e quinze","00:15"],["meio dia e quarenta e cinco minutos","12:45"]])("checks anchored clock %s",(text,time)=>{
    expect(ground(`O horário é ${text}.`,{time},[{field:"time",text}]).rejected).toEqual([]);
    expect(ground(text,{time:"10:00"},[{field:"time",text}]).fields.time).toBeUndefined();
  });
  it.each([["meio-dia e meia","meio-dia"],["meia-noite e quinze","meia-noite"],["meio-dia e meia da noite","meio-dia e meia"]])("does not drop an anchor qualifier %s",(source,text)=>{
    expect(ground(source,{time:"12:00"},[{field:"time",text}]).fields.time).toBeUndefined();
  });
  it.each(["meio-dia e sessenta","meio-dia e -5 minutos","meio-dia e 2 horas"])("rejects invalid minute composition %s",text=>{
    expect(ground(text,{time:"12:00"},[{field:"time",text}]).fields.time).toBeUndefined();
  });
  it.each(["meio-dia e 3h","meio-dia mais 3 minutos","meio-dia menos 3 minutos","meio-dia e 3,5 minutos"])("does not certify an incomplete arithmetic anchor %s",text=>{
    for(const literal of [text,"meio-dia"])
      expect(ground(text,{time:"12:00"},[{field:"time",text:literal}]).fields.time).toBeUndefined();
  });
  it("does not hide a second clock inside an anchor quote",()=>{
    const text="meio-dia ou às 15h";
    expect(ground(text,{time:"12:00"},[{field:"time",text}]).fields.time).toBeUndefined();
  });
  it.each(["daqui a 3 dias e 2 semanas","daqui a 3 dias mais 2 dias","daqui a 3 dias menos 2 dias"])("does not certify an incomplete calendar composition %s",text=>{
    for(const literal of [text,"daqui a 3 dias"])
      expect(ground(text,{day_offset:3},[{field:"date",text:literal}]).fields.date).toBeUndefined();
  });
});

describe("interval endpoints and shared qualifiers stay in their own relation",()=>{
  it.each([
    ["entre uma e seis da tarde","uma","seis da tarde","13:00","18:00"],
    ["entre duas e cinco da tarde","duas","cinco da tarde","14:00","17:00"],
    ["entre seis e dez da noite","seis","dez da noite","18:00","22:00"],
    ["das 13h às 18h","13h","18h","13:00","18:00"],
    ["entre 13:15 e 18:30","13:15","18:30","13:15","18:30"],
    ["entre meio-dia e seis da tarde","meio-dia","seis da tarde","12:00","18:00"],
  ])("corroborates two exact endpoints %s",(text,left,right,time,end_time)=>{
    const evidence:Evidence=[{field:"time",text:left},{field:"end_time",text:right}];
    expect(ground(`Horários ${text}.`,{time,end_time},evidence,"availability.get").rejected).toEqual([]);
    expect(ground(text,{time:end_time,end_time:time},evidence,"availability.get").fields.time).toBeUndefined();
  });
  it("does not turn a minute composition into two interval endpoints",()=>{
    const source="às dez e quinze";
    expect(ground(source,{time:"10:00",end_time:"15:00"},[{field:"time",text:"dez"},{field:"end_time",text:"quinze"}],"availability.get").rejected.length).toBeGreaterThan(0);
  });
  it.each([
    [{time:"13:00",end_time:"18:00"},[{field:"time",text:"uma"},{field:"end_time",text:"seis"}]],
    [{time:"13:00"},[{field:"time",text:"uma"}]],
    [{time:"01:00",end_time:"18:00"},[{field:"time",text:"uma"},{field:"end_time",text:"seis da tarde"}]],
    [{source_time:"13:00",end_time:"18:00"},[{field:"source_time",text:"uma"},{field:"end_time",text:"seis da tarde"}]],
  ] as [SchedulingFields,Evidence][])("does not forge/omit the relation or its shared qualifier",(raw,evidence)=>{
    const result=ground("entre uma e seis da tarde",raw,evidence,"availability.get");
    expect(result.fields.time??result.fields.source_time).toBeUndefined();
  });
  it("does not take a daypart from a disconnected sentence",()=>{
    const source="entre uma e seis. Outro atendimento é à tarde.";
    expect(ground(source,{time:"13:00",end_time:"18:00"},[{field:"time",text:"uma"},{field:"end_time",text:"seis"}],"availability.get").fields.time).toBeUndefined();
  });
  it("retains spans for primitive arithmetic without mutating text",()=>{
    expect(clockComponents("entre uma e seis da tarde").map(p=>p.value)).toEqual(["13:00","18:00"]);
    expect(relativeDayComponents("daqui a tres dias")).toEqual([{start:0,end:17,days:3}]);
  });
});
