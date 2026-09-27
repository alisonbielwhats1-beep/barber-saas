import { describe, expect, it } from "vitest";
import { validateTemporalNegativeContext, type TemporalNegativeContextInput, type TemporalNegativeContextBinding } from "../scheduling-temporal-negative-context";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import type { SchedulingFields } from "../scheduling-contract";
import type { SchedulingTemporalEvidence } from "../../../packages/salon-secretary/src/scheduling-skill";
import fixture from "../../test/fixtures/secretary-temporal-consumed-holdout-v2.json";

const now=new Date("2028-06-12T12:00:00Z");
type Args=Parameters<typeof validateTemporalNegativeContext>[1];
const consent=(literal="Não autorizo sobreposição.",anchor="sobreposição"):TemporalNegativeContextInput=>({proof:{negative_context:[{
  role:"OVERRIDE_CONSENT",literal,anchor:{field:"override_requested",value:false,literal:anchor},
}]}});
const standard=(source="Terça às 9h45. Não autorizo sobreposição."):Args=>({source,previous:{},raw:{weekday:2,time:"09:45",override_requested:false},
  evidence:[{field:"date",text:"Terça"},{field:"time",text:"às 9h45"}],operation:"appointment.create",now});
const binding=(fields:SchedulingFields={date:"2028-06-17",time:"12:00"}):TemporalNegativeContextBinding=>({
  expectedDraft:{draft_ref:"draft-a",draft_revision:7},
  liveDraft:{draft_ref:"draft-a",draft_revision:7,expires_at:"2028-06-12T12:20:00Z",scope_valid:true,fields},
});
const prior=():TemporalNegativeContextInput=>({proof:{negative_context:[{role:"PRIOR_CALENDAR_CONDITION",literal:"Se sábado não abre",anchor:{field:"date",literal:"sábado"}}]},binding:binding()});
const priorArgs=():Args=>({source:"Se sábado não abre, tenta no domingo seguinte às 12h.",previous:{date:"2028-06-17",time:"12:00"},
  raw:{date:"2028-06-18",destination_mode:"ALTERNATIVE_SLOT"},evidence:[{field:"date",text:"domingo seguinte"}],operation:"appointment.create",now});
const ground=(args:Args,input:TemporalNegativeContextInput)=>groundSchedulingTemporal(args.previous,args.raw,args.source,"America/Sao_Paulo",args.now,undefined,args.operation,args.evidence,undefined,input);
const expectBlocked=(args:Args,input:TemporalNegativeContextInput)=>{
  expect(validateTemporalNegativeContext(input,args).valid).toBe(false);
  const result=ground(args,input);expect(result.rejected.length).toBeGreaterThan(0);expect(result.fields.date).toBeUndefined();
};

describe("NEW CONTRACT counterfactuals, not original Luna replay",()=>{
  it("keeps V216 source/raw independent and adds explicitly synthetic semantic proof",()=>{
    const source=fixture.cases.find(row=>row.caseId==="V216")!.source;
    const args=standard(source);args.evidence=[{field:"date",text:"na terça"},{field:"time",text:"às 9h45"}];
    const input=consent("Se houver conflito, ainda não autorizo sobreposição.");
    expect(validateTemporalNegativeContext(input,args).valid).toBe(true);
    const result=ground(args,input);expect(result.rejected).toEqual([]);
    expect(result.fields).toMatchObject({date:"2028-06-13",time:"09:45",override_requested:false});
    expect(result.fields).not.toHaveProperty("negative_context");
    // Clause-scoped negation (2026-09-27): the denial is in a separate sentence, so no proof is needed.
    expect(groundSchedulingTemporal({},args.raw,source,"America/Sao_Paulo",now,undefined,args.operation,args.evidence).rejected).toEqual([]);
    // A denial governing the same clause as the literals still fails closed without proof.
    expect(groundSchedulingTemporal({},args.raw,"Não quero Peeling Suave para Rosa Viana com Bel na terça às 9h45.","America/Sao_Paulo",now,undefined,args.operation,args.evidence).rejected.length).toBeGreaterThan(0);
  });
  it("keeps V217 raw unchanged unless a new proof is paired with the live previous draft",()=>{
    const args=priorArgs();expect(args.source).toBe(fixture.cases.find(row=>row.caseId==="V217")!.source);
    const input=prior();expect(validateTemporalNegativeContext(input,args).valid).toBe(true);
    expect(ground(args,input).fields).toMatchObject({date:"2028-06-18",time:"12:00",destination_mode:"ALTERNATIVE_SLOT"});
    expect(ground(args,input).rejected).toEqual([]);
    // Clause-scoped negation (2026-09-27): "Se sábado não abre" is a separate clause from the new destination.
    expect(groundSchedulingTemporal(args.previous,args.raw,args.source,"America/Sao_Paulo",now,undefined,args.operation,args.evidence).rejected).toEqual([]);
    expect(groundSchedulingTemporal(args.previous,args.raw,"Não tenta no domingo seguinte às 12h.","America/Sao_Paulo",now,undefined,args.operation,args.evidence).rejected.length).toBeGreaterThan(0);
  });
  it.each(["não","nunca","jamais","nem"])("isolates a literal consent dimension with %s",word=>{
    const text=`${word} autorizo encaixe.`,args=standard(`Terça às 9h45. ${text}`);
    expect(validateTemporalNegativeContext(consent(text,"encaixe"),args).valid).toBe(true);
    expect(ground(args,consent(text,"encaixe")).rejected).toEqual([]);
  });
  it("uses exact original offsets for decomposed Unicode",()=>{
    const text="Na\u0303o autorizo sobreposic\u0327a\u0303o.",anchor="sobreposic\u0327a\u0303o",args=standard(`Terça às 9h45. ${text}`);
    const result=validateTemporalNegativeContext(consent(text,anchor),args);
    expect(result.valid).toBe(true);
    expect(result.ignoredNegators.map(span=>args.source.slice(span.start,span.end))).toEqual(["Na\u0303o"]);
  });
  it.each(["2028-06-17","17/06/2028"])("corroborates exact accepted previous calendar %s",literal=>{
    const input=prior(),args=priorArgs();args.source=`Se ${literal} não abre, tenta no domingo seguinte às 12h.`;
    input.proof={negative_context:[{role:"PRIOR_CALENDAR_CONDITION",literal:`Se ${literal} não abre`,anchor:{field:"date",literal}}]};
    expect(validateTemporalNegativeContext(input,args).valid).toBe(true);
  });
  it("never changes raw, proof, draft or source",()=>{
    const input=prior(),args=priorArgs(),before=JSON.stringify({input,args});
    ground(args,input);expect(JSON.stringify({input,args})).toBe(before);
  });
  it("supports two disjoint factual roles without swallowing residual words",()=>{
    const input=prior(),args=priorArgs();args.source+=" Não autorizo sobreposição.";args.raw.override_requested=false;
    input.proof={negative_context:[...(input.proof as {negative_context:unknown[]}).negative_context,
      ...(consent().proof as {negative_context:unknown[]}).negative_context]};
    expect(validateTemporalNegativeContext(input,args).valid).toBe(true);expect(ground(args,input).rejected).toEqual([]);
  });
});

describe("factual negative-role boundaries remain closed",()=>{
  it.each(["desencaixe","superencaixe","encaixeExtra","encaixe0","0encaixe","encaixe_","_encaixe","encaixe\u0301","\u0301encaixe","encaixe\u200d","\u200dencaixe","encaixeα","αencaixe","encaixe𐐀","𐐀encaixe","encaixe客","客encaixe"])("requires whole original Unicode anchor in %s",word=>{
    const text=`Não autorizo ${word}.`;expectBlocked(standard(`Terça às 9h45. ${text}`),consent(text,"encaixe"));
  });
  it.each(["encaixe","encaixe\u0301","ENCAIXE"])("accepts the complete original anchor %s without changing offsets",anchor=>{
    const text=`Não autorizo (${anchor}).`,args=standard(`Terça às 9h45. ${text}`);
    const result=validateTemporalNegativeContext(consent(text,anchor),args);expect(result.valid).toBe(true);
    expect(result.ignoredNegators.map(span=>args.source.slice(span.start,span.end))).toEqual(["Não"]);
  });
  it.each(["appointment.change","appointment.cancel","appointment.read","availability.get","schedule.block"])("does not expand operation %s",operation=>expectBlocked({...standard(),operation},consent()));
  it.each([undefined,true])("never manufactures override=false from %s",override_requested=>expectBlocked({...standard(),raw:{weekday:2,time:"09:45",override_requested}},consent()));
  it.each([{},null,{negative_context:[]},{negative_context:[{role:"OTHER",literal:"Não autorizo sobreposição."}]},{negative_context:[{role:"OVERRIDE_CONSENT",literal:"Não autorizo sobreposição.",anchor:{field:"override_requested",value:false,literal:"sobreposição"},source_scope:"Terça"}]}])("rejects invalid/extra typed shape %#",proof=>expectBlocked(standard(),{proof}));
  it("rejects a model-owned draft identity inside the proof",()=>{
    const input=prior();input.proof={...(input.proof as object),draft_ref:"draft-a"};expectBlocked(priorArgs(),input);
  });
  it.each(["Não faça isso.","Não autorizo.","Não autorizo cancelamento."])("requires the exact consent dimension in %s",text=>expectBlocked(standard(`Terça às 9h45. ${text}`),consent(text,text.split(" ").at(-1)!.replace(".",""))));
  it.each([
    ["Não autorizo sobreposição.","autorizo sobreposição."],
    ["Eu não autorizo sobreposição.","não autorizo sobreposição."],
    ["Não autorizo sobreposição nem amanhã.","Não autorizo sobreposição"],
    ["Não autorizo sobreposição.","Não autorizo encaixe."],
  ])("rejects clipped, unanchored or foreign proof %#",(text,literal)=>expectBlocked(standard(`Terça às 9h45. ${text}`),consent(literal)));
  it("rejects duplicated current literals",()=>expectBlocked(standard("Terça às 9h45. Não autorizo sobreposição. Não autorizo sobreposição."),consent()));
  it("rejects overlapping proof ranges",()=>{
    const input=consent();input.proof={negative_context:[...(input.proof as {negative_context:unknown[]}).negative_context,...(input.proof as {negative_context:unknown[]}).negative_context]};expectBlocked(standard(),input);
  });
  it.each(["Não agende. ","Nunca agende. ","Jamais agende. ","Nem agende. "])("cannot discard a residual refusal %s",prefix=>expectBlocked(standard(`${prefix}Terça às 9h45. Não autorizo sobreposição.`),consent()));
  it("cannot launder negation of the positive temporal instruction",()=>{
    const source="Não agende terça às 9h45 com sobreposição.",args=standard(source);args.evidence=[{field:"date",text:"terça"},{field:"time",text:"às 9h45"}];
    expectBlocked(args,consent(source));
  });
  it.each(["amanhã","às 10h","terça","no dia 17","à tarde","meio-dia"])("cannot hide temporal facts %s in the excluded clause",atom=>{
    const text=`Não autorizo sobreposição ${atom}.`;expectBlocked(standard(`Terça às 9h45. ${text}`),consent(text));
  });
  it.each(["customer_name","professional_name","service_name"] as const)("cannot hide the accepted entity %s",key=>{
    const text="Não autorizo sobreposição para Rosa Viana.",args=standard(`Terça às 9h45. ${text}`);args.raw[key]="Rosa Viana";
    expectBlocked(args,consent(text));
  });
  it.each(["Não agende e não autorizo sobreposição.","Não agende, só discutimos sobreposição."])("does not assign another denial or disconnected clause to consent: %s",text=>{
    expectBlocked(standard(`Terça às 9h45. ${text}`),consent(text));
  });
  it.each(["ROSA VIANA","rosa viana","Ro\u0301sa Viana"])("keeps normalized accepted identity visible: %s",name=>{
    const text=`Não autorizo sobreposição para ${name}.`,args=standard(`Terça às 9h45. ${text}`);args.raw.customer_name="Rosa Viana";
    expectBlocked(args,consent(text));
  });
  it.each([undefined,[],[{field:"date",text:"Terça"}],[{field:"date",text:"Terça"},{field:"time",text:"às 9h45"},{field:"time",text:"às 9h45"}] ] as (SchedulingTemporalEvidence|undefined)[])("requires positive current proof for every supplied role %#",evidence=>expectBlocked({...standard(),evidence},consent()));
  it("does not reactivate prior complete fields on consent text alone",()=>{
    const args=standard("Não autorizo sobreposição.");args.previous={date:"2028-06-13",time:"09:45"};args.raw={override_requested:false};args.evidence=[];
    expectBlocked(args,consent());
  });
  it("does not use the negative role as authority for wrong time/weekday",()=>{
    const args=standard();args.raw={weekday:3,time:"10:00",override_requested:false};
    expect(validateTemporalNegativeContext(consent(),args).valid).toBe(true);
    expect(ground(args,consent()).fields.date).toBeUndefined();expect(ground(args,consent()).fields.time).toBeUndefined();
  });
  it("does not let an invalid context proof pass without a current message",()=>{
    const result=groundSchedulingTemporal({date:"2028-06-13",time:"09:45"},{},undefined,"America/Sao_Paulo",now,undefined,"appointment.create",undefined,undefined,consent());
    expect(result.rejected.length).toBeGreaterThan(0);expect(result.fields.date).toBeUndefined();
  });
});

describe("previous calendar context is a live backend binding",()=>{
  it("requires a backend binding",()=>{const input=prior();delete input.binding;expectBlocked(priorArgs(),input);});
  it.each(["scope","ref","revision","expiry","invalid-expiry","fields","no-ref","zero-revision"])("rejects stale or cross-context %s",kind=>{
    const input=prior(),live=input.binding!.liveDraft;
    if(kind==="scope")live.scope_valid=false;
    if(kind==="ref")live.draft_ref="other";
    if(kind==="revision")live.draft_revision++;
    if(kind==="expiry")live.expires_at=now.toISOString();
    if(kind==="invalid-expiry")live.expires_at="invalid";
    if(kind==="fields")live.fields={date:"2028-06-16",time:"12:00"};
    if(kind==="no-ref")live.draft_ref="";
    if(kind==="zero-revision")live.draft_revision=0;
    expectBlocked(priorArgs(),input);
  });
  it.each(["sexta-feira","domingo","2028-06-18","18/06/2028"])("cannot claim wrong accepted calendar %s",literal=>{
    const input=prior(),args=priorArgs();args.source=`Se ${literal} não abre, tenta no domingo seguinte às 12h.`;
    input.proof={negative_context:[{role:"PRIOR_CALENDAR_CONDITION",literal:`Se ${literal} não abre`,anchor:{field:"date",literal}}]};expectBlocked(args,input);
  });
  it("does not compare against a date manufactured in the current raw",()=>{
    const input=prior(),args=priorArgs();args.previous={time:"12:00"};input.binding=binding(args.previous);expectBlocked(args,input);
  });
  it.each(["Se sábado seguinte não abre","Se sábado, 2028-06-18, não abre"])("does not hide an adjacent calendar contradiction %s",literal=>{
    const input=prior(),args=priorArgs();args.source=`${literal}, tenta no domingo seguinte às 12h.`;
    input.proof={negative_context:[{role:"PRIOR_CALENDAR_CONDITION",literal,anchor:{field:"date",literal:"sábado"}}]};expectBlocked(args,input);
  });
  it.each(["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"])("cannot drop a calendar qualifier %s from the previous anchor",month=>{
    const input=prior(),args=priorArgs(),literal=`Se sábado de ${month} não abre`;args.source=`${literal}, tenta no domingo seguinte às 12h.`;
    input.proof={negative_context:[{role:"PRIOR_CALENDAR_CONDITION",literal,anchor:{field:"date",literal:"sábado"}}]};expectBlocked(args,input);
  });
  it("does not certify an invalid weekday spelling by trimming its suffix",()=>{
    const input=prior(),args=priorArgs(),literal="Se sábado-feira não abre";args.source=`${literal}, tenta no domingo seguinte às 12h.`;
    input.proof={negative_context:[{role:"PRIOR_CALENDAR_CONDITION",literal,anchor:{field:"date",literal:"sábado-feira"}}]};expectBlocked(args,input);
  });
  it("requires a different current date target",()=>{const args=priorArgs();args.raw.date="2028-06-17";expectBlocked(args,prior());});
  it("cannot consume the new Sunday proof as old context",()=>{
    const input=prior(),args=priorArgs();input.proof={negative_context:[{role:"PRIOR_CALENDAR_CONDITION",literal:args.source,anchor:{field:"date",literal:"sábado"}}]};expectBlocked(args,input);
  });
});
