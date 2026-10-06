import { expect, it } from 'vitest';
import { schedulingFields, createServicesAgent } from '@everflair/salon-secretary';
import { ScriptedServicesModel } from '../../test/scripted-services-model';
it('publishes a complete calendar coordinate system independently of role and skill',()=>{
 const mapping='Calendário 0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado. Não usar segunda como zero.';
 for(const field of ['weekday','source_weekday'] as const){expect(schedulingFields[field].description).toContain(mapping);expect(schedulingFields[field].parse(0)).toBe(0);expect(schedulingFields[field].parse(6)).toBe(6);}
 expect(schedulingFields.source_weekday.description).toContain('ORIGEM');expect(schedulingFields.weekday.description).toContain('DESTINO');
 for(const skill of ['discovery','scheduling','scheduling-batch'] as const){
  const agent=createServicesAgent(new ScriptedServicesModel([]),()=>{},skill,true);
  expect(JSON.stringify(agent.tools[0])).toContain(mapping);
 }
});
