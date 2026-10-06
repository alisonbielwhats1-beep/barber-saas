import {expect,it} from 'vitest';
import {createActionPlan,assessPlanAction} from '@everflair/salon-secretary';
import {intent,plan} from '../../test/secretary-capability-plan';
import {planConversationContext,secretaryPlanMessage} from '../secretary-presentation';
import type {SecretaryView} from '../salon-secretary';
import {schedulingState} from '../secretary-scheduling';
import {customerState} from '../secretary-customers';
import {clarificationContext} from '../secretary-clarification';
function fixture(operation:'customer.read'|'appointment.create',state:Partial<SecretaryView>){
  let p=createActionPlan(plan([intent(operation,{item_key:'a'})]));
  p=assessPlanAction(p,'a',{status:'NEEDS_INPUT',missing_fields:operation==='customer.read'?['customer_ref']:['service_ref']});
  const units=[{kind:'single' as const,keys:['a'],child:'child'}];const children=[{operation_ref:'child',state:{sessionId:'child',cancelled:false,message:'Selecione.',...state}}];
  return {context:planConversationContext(p,units,children).actions[0],message:secretaryPlanMessage(p,units,children)};
}
it('offers masked discriminators and semantic input mapping for homonymous customers',()=>{
 const candidates=[{id:'private-a',name:'Rita Costa',phone:'***0011'},{id:'private-b',name:'Rita Costa',phone:'***0022'}];
 const {context,message}=fixture('customer.read',{customer:{...customerState(),operation:'customer.read',query:'Rita Costa',candidates}});
 expect(context.clarification).toMatchObject({requested_field:'customer_ref',response_fields:['target_name'],candidates:[{label:'Rita Costa · ***0011'},{label:'Rita Costa · ***0022'}]});
 expect(message).toContain('***0011');expect(message).toContain('***0022');expect(JSON.stringify(context)).not.toContain('private-');
});
it('maps a pending scheduling service to the schema field Luna can actually return',()=>{
 const {context}=fixture('appointment.create',{scheduling:{...schedulingState(),operation:'appointment.create',fields:{service_name:'Corte'},candidates:{kind:'service_ref',items:[{id:'a',name:'Corte Curto'},{id:'b',name:'Corte Longo'}]}}});
 expect(context.clarification).toMatchObject({requested_field:'service_ref',response_fields:['service_name'],candidates:[{label:'Corte Curto'},{label:'Corte Longo'}]});
});
it('maps message recipients to communication fields without treating them as customer mutations',()=>{
 const context=clarificationContext({operation:'customer.message',fields:{},waiting_for:'customer_ref',message:'Qual cliente?',selection:{field:'customer_ref',labels:['Rita']}});
 expect(context.clarification.response_fields).toEqual(['recipient_name']);
});
