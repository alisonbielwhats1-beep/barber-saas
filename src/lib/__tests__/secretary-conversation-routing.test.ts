import { expandedWire, operationWire, turnWire, suspendedWirePlan } from '../../test/secretary-wire-schema';
import { describe, expect, it } from "vitest";
import { createServicesAgent, runServicesTurn, SecretaryNewRequest, withConversationRouting } from "@everflair/salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
const empty={name:null,priceCents:null,durationMin:null};
describe("single-inference conversation routing boundary",()=>{
  it("preserves normal corrections and removes routing metadata before adapters",async()=>{
    const model=new ScriptedServicesModel([call("upsert_action_draft",{...empty,priceCents:9000,new_request:null})]);
    expect(await withConversationRouting(()=>runServicesTurn(model,"Não, noventa reais.",{},{}))).toEqual({priceCents:9000});
    expect(model.requests).toHaveLength(1);
  });
  it("rejects mixed old patch and new request instead of partially applying either",async()=>{
    const model=new ScriptedServicesModel([call("upsert_action_draft",{...empty,priceCents:9000,new_request:plan([intent("service.create",{name:"Novo"})])})]);
    await expect(withConversationRouting(()=>runServicesTurn(model,"Outro pedido",{},{}))).rejects.toThrow("CONVERSATION_ROUTE_CONFLICT");
  });
  it("does not permit routing metadata outside coordinator scope",async()=>{
    const model=new ScriptedServicesModel([call("upsert_action_draft",{...empty,new_request:plan([intent("service.create")])})]);
    await expect(runServicesTurn(model,"Outro pedido",{},{})).rejects.toThrow();
  });
  it("carries a validated new intent without invoking another model",async()=>{
    const selection=plan([intent("service.change",{target_name:"Hidratação",priceCents:9000})]);
    const model=new ScriptedServicesModel([call("upsert_action_draft",{...empty,new_request:selection})]);
    await expect(withConversationRouting(()=>runServicesTurn(model,"Mude o preço da Hidratação",{},{}))).rejects.toBeInstanceOf(SecretaryNewRequest);
    expect(model.requests).toHaveLength(1);
  });
  it("publishes nested key and weekday guards in the actual SDK tool",async()=>{
    await withConversationRouting(async()=>{
      const agent=createServicesAgent(new ScriptedServicesModel([]),()=>{},"scheduling");
      const tool=agent.tools[0];if(tool.type!=="function")throw Error("tool");
      const wire=expandedWire(tool.parameters);
      const op=operationWire(turnWire(wire,'NEW'), "appointment.create");
      expect(op.item_key.anyOf![0].pattern).toBe("^[a-z][a-z0-9_]{0,31}$");
      expect(op.weekday.anyOf![0].properties!.value.minimum).toBe(0);expect(op.weekday.anyOf![0].properties!.value.maximum).toBe(6);
    });
  });
});

it("cannot attach casual prose to an operational selection",async()=>{
  const model=new ScriptedServicesModel([call("select_capabilities",{...plan([intent("service.create")]),disposition:"SUPPORTED",conversation_response:"Concluído."})]);
  await expect(runServicesTurn(model,"Crie o serviço",{},{},"discovery",true)).rejects.toThrow("CAPABILITY_DISPOSITION_MISMATCH");
});
it('resume transport publishes only suspended refs and preserves temporal bounds',async()=>{
  await withConversationRouting(async()=>{
    const tool=createServicesAgent(new ScriptedServicesModel([]),()=>{},'scheduling').tools[0];if(tool.type!=='function')throw Error('tool');
    const wire=expandedWire(tool.parameters),resume=turnWire(wire,'RESUME');
    expect(resume.properties!.plan_ref.enum).toEqual([suspendedWirePlan.plan_ref]);
    const op=operationWire(resume.properties!.patches.anyOf!.find(x=>x.properties)!, 'appointment.change');
    expect(op.item_key.pattern).toBe('^[a-z][a-z0-9_]{0,31}$');expect(op.item_key.enum).toEqual(['a']);
    expect(op.source_weekday.anyOf![0].properties!.value.minimum).toBe(0);expect(op.source_weekday.anyOf![0].properties!.value.maximum).toBe(6);
  },{suspended_plans:[suspendedWirePlan]});
});
it.each(['scheduling','scheduling-batch','discovery'] as const)('publishes bounded temporal evidence in %s and all routing envelopes',async skill=>{
  await withConversationRouting(async()=>{
    const tool=createServicesAgent(new ScriptedServicesModel([]),()=>{},skill,true).tools[0];if(tool.type!=='function')throw Error('tool');
    const wire=expandedWire(tool.parameters);
    const newOp=operationWire(turnWire(wire,'NEW'),'appointment.create');
    const resumed=turnWire(wire,'RESUME').properties!.patches.anyOf!.find(x=>x.properties)!;
    const resumeOp=operationWire(resumed,'appointment.change');
    const evidence=[skill==='discovery'?operationWire(wire,'appointment.create'):turnWire(wire,'CURRENT').properties!.fields.properties!,newOp,resumeOp];
    for(const fields of evidence){
      expect(fields).not.toHaveProperty('temporal_evidence');const schema=fields.weekday;
      const object=schema.anyOf!.find(x=>x.type==='object')!;
      expect(Object.keys(object.properties!)).toEqual(['value','literal']);
      expect(object.required).toEqual(Object.keys(object.properties!));expect(object.additionalProperties).toBe(false);
      expect(object.properties!.literal).toMatchObject({type:'string',minLength:1,maxLength:600,pattern:'\\S'});
      expect(schema.anyOf!.some(x=>x.type==='array')).toBe(false);
    }
  },{suspended_plans:[suspendedWirePlan]});
});
