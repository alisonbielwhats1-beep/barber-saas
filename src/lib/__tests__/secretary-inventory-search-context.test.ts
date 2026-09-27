import { describe, expect, it } from 'vitest';
import { createActionPlan, assessPlanAction, createServicesAgent, inventoryInterpretation } from '@everflair/salon-secretary';
import { assessmentFromView } from '../secretary-action-plan';
import { planConversationContext, secretaryPlanMessage } from '../secretary-presentation';
import { inventoryState } from '../secretary-inventory';
import type { SecretaryView } from '../salon-secretary';
import { ScriptedServicesModel } from '../../test/scripted-services-model';
import { intent, plan } from '../../test/secretary-capability-plan';
const makePlan=()=>createActionPlan(plan([intent('stock.movement',{item_key:'stock',inventory:{product_name:'Produto inexistente',mode:'OUT',quantity:3}})]));
function buildView(candidates:NonNullable<ReturnType<typeof inventoryState>['candidates']>=[]):SecretaryView{
 return {sessionId:'child',cancelled:false,message:'Não encontrei esse produto neste salão.',inventory:{...inventoryState(),operation:'stock.movement',query:'Produto inexistente',fields:{mode:'OUT',quantity:3},candidates}};
}
describe('product lookup language and missing-state contracts',()=>{
 it('asks for a resolvable product, never an absent selection option',()=>{
  const initial=makePlan(),view=buildView(),assessment=assessmentFromView(view,initial.actions[0]);
  expect(assessment).toMatchObject({status:'NEEDS_INPUT',missing_fields:['product_name']});
  const current=assessPlanAction(initial,'stock',assessment),units=[{keys:['stock'],kind:'single' as const,child:'child'}],children=[{operation_ref:'child',state:view}];
  expect(secretaryPlanMessage(current,units,children)).toContain('produto');
  expect(secretaryPlanMessage(current,units,children)).not.toContain('opção');
  expect(planConversationContext(current,units,children).actions[0].clarification.missing_fields).toEqual(['product_name']);
  expect(view.inventory!.fields).toEqual({mode:'OUT',quantity:3});
 });
 it('keeps real multiple candidates as a selection instead of choosing one',()=>{
  const candidates=['a','b'].map(id=>({id,name:'Produto '+id,stock:10,minStock:1,active:true,unit:'un' as const,revision:'r'.repeat(64)}));
  const view=buildView(candidates),initial=makePlan();
  expect(assessmentFromView(view,initial.actions[0])).toMatchObject({status:'NEEDS_INPUT',missing_fields:['selection']});
  expect(view.inventory!.target).toBeUndefined();expect(view.inventory!.proposal).toBeUndefined();
 });
 it('places the same semantic selector contract on discovery and inventory wire schemas',()=>{
  const description=inventoryInterpretation.shape.product_name.description!;
  expect(description).toContain('produto individual');expect(description).toContain('qualificadores');
  for(const skill of ['discovery','inventory'] as const){
   const agent=createServicesAgent(new ScriptedServicesModel([]),()=>{},skill,true);
   expect(JSON.stringify(agent.tools[0])).toContain(description);
  }
 });
 it('does not singularize labels, weaken references or convert units in the backend schema',()=>{
  const commercialName='Óleos Profissionais Série S';
  expect(inventoryInterpretation.parse({product_name:commercialName,quantity:4})).toEqual({product_name:commercialName,quantity:4});
  expect(()=>inventoryInterpretation.parse({product_ref:'invented',quantity:4})).toThrow();
  expect(()=>inventoryInterpretation.parse({product_name:commercialName,quantity:'duas caixas'})).toThrow();
 });
});
