import { describe,it,expect,vi } from "vitest";
import { communicationInterpretation,communicationSkill,loadSkills,validateSelection,createServicesAgent,runServicesTurn } from "@everflair/salon-secretary";
import { reconcileMessageContent,exactMessageContent,communicationChannelFastPath,communicationState } from "../secretary-communication";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent,plan } from "../../test/secretary-capability-plan";

describe("Communication boundary / exact source / disclosure",()=>{
  it.each(['  Serviço cancelado, Fábio.  ','Olá!\nConfirma? 👋','Acentos: ação, café.'])('EXACT source preserved including whitespace: %s',content=>{
    const raw=`Mande exatamente no WhatsApp para Fábio: “${content}”`;
    expect(exactMessageContent(raw)).toBe(content);
    expect(reconcileMessageContent({},{message_mode:"EXACT",content:"Modelo tentou reescrever"},raw)).toEqual({message_mode:"EXACT",content});
  });
  it("generated suggestion requires explicit request, exact cannot be silently replaced",()=>{
    expect(()=>reconcileMessageContent({},{message_mode:"GENERATED",content:"Olá"},"Avise Fábio")).toThrow("MESSAGE_CONTENT_REVIEW_REQUIRED");
    expect(reconcileMessageContent({},{message_mode:"GENERATED",content:"Olá"},"Avise educadamente o Fábio")).toEqual({message_mode:"GENERATED",content:"Olá"});
    expect(reconcileMessageContent({content:"  texto  ",message_mode:"EXACT"},{channel:"WHATSAPP"},"WhatsApp")).toMatchObject({content:"  texto  ",message_mode:"EXACT"});
    expect(exactMessageContent('Mande “a” ou “b”')).toBeUndefined();
  });
  it.each(['customer_ref','recipient_ref','phone','salonId','sql','template_ref','provider','message_ref'])('model cannot inject %s',key=>{
    expect(()=>communicationInterpretation.parse({[key]:'arbitrary'})).toThrow();
  });
  it("channel fast-path only when exclusively missing channel",()=>{
    const s={...communicationState(),draft:{missing_fields:["channel"]}} as ReturnType<typeof communicationState>;
    expect(communicationChannelFastPath(s,"WhatsApp")).toEqual({channel:"WHATSAPP"});
    for(const text of ['talvez WhatsApp','WhatsApp e email','sms','envie agora'])expect(communicationChannelFastPath(s,text)).toBeUndefined();
    expect(communicationChannelFastPath(communicationState(),"WhatsApp")).toBeUndefined();
  });
  it("Financial + Communication independent; cancellation requires an explicit valid edge",()=>{
    const msg=intent("customer.message",{item_key:"b",communication:{recipient_name:"Fábio"}});
    expect(validateSelection(plan([intent("financial.report",{financial:{period:"today"}}),msg])).skills).toEqual(["financial","communication"]);
    const a=intent("appointment.cancel",{item_key:"a"});
    expect(()=>validateSelection(plan([a,msg]))).toThrow("UNSUPPORTED_COMMUNICATION_DEPENDENCY");
    expect(validateSelection({...plan([a,{...msg,depends_on:["a"]}]),independent:false}).operations[1].depends_on).toEqual(["a"]);
    for(const operation of ["appointment.create","appointment.change"]){expect(()=>validateSelection({...plan([intent(operation,{item_key:"a"}),{...msg,depends_on:["a"]}]),independent:false})).toThrow();}
    for(const depends_on of [["missing"],["b"]])expect(()=>validateSelection({...plan([a,{...msg,depends_on}]),independent:false})).toThrow();
  });
  it("one normal Agent, only function tools, no extra manual on unrelated requests",async()=>{
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("customer.message",{communication:{recipient_name:"Fábio",channel:"WHATSAPP",message_mode:"EXACT",content:"Oi"}})]))]);
    expect((await runServicesTurn(fake,'Mande para Fábio: “Oi”',{}, {},"discovery")).skills).toEqual(["communication"]);
    expect(fake.requests).toHaveLength(1);
    const agent=createServicesAgent(fake,vi.fn(),"communication");expect(agent.instructions).toBe(communicationSkill);expect(agent.tools.map(t=>[t.type,t.name])).toEqual([["function","upsert_action_draft"]]);expect(agent.handoffs).toEqual([]);expect(agent.modelSettings.store).toBe(false);
    expect(loadSkills({skill_ids:["communication"]}).manuals).toHaveLength(1);
    for(const id of ['services','customers','scheduling','financial','inventory'])expect(loadSkills({skill_ids:[id]}).manuals.some(m=>m.skill_id==='communication')).toBe(false);
  });
});
