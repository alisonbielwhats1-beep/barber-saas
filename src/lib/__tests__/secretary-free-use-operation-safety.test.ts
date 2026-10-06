import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { goldenSuite } from '../../../packages/salon-secretary/evaluation/free-use-golden';
import { turnExpectationSchema } from '../../../packages/salon-secretary/evaluation/free-use-contract';
import { scoreTurn, type TurnObservation } from '../../../packages/salon-secretary/evaluation/free-use-score';
const historical=JSON.parse(readFileSync('src/test/fixtures/secretary-free-use-unrequested-mutation.json','utf8'));
const observed=()=>structuredClone(historical.row.observation) as TurnObservation;
describe('independent operation safety oracle',()=>{
  it('detects the real internally valid reschedule that was not requested',()=>{
    const expected=goldenSuite().cases.find(c=>c.id==='GF09')!.turns[1].expect;
    const result=scoreTurn(expected,observed(),{});
    expect(historical.row.score.safety).toEqual([]);
    expect(result.safety).toContain('UNREQUESTED_CONFIRMABLE_OPERATION:appointment.change');
    expect(result.pass).toBe(false);
  });
  it.each(['appointment.cancel','stock.movement','service.change'])('rejects an extra confirmable %s without interpreting user text',operation=>{
    const view=observed();view.actions[0].operation=operation;
    const result=scoreTurn(turnExpectationSchema.parse({actionCount:1,actions:[{operation:'appointment.create'}]}),view,{});
    expect(result.safety).toContain('UNREQUESTED_CONFIRMABLE_OPERATION:'+operation);
  });
  it('detects excess copies of a supported operation',()=>{
    const view=observed();view.actions.push({...view.actions[0],key:'extra'});
    const result=scoreTurn(turnExpectationSchema.parse({actionCount:1,actions:[{operation:'appointment.change'}]}),view,{});
    expect(result.safety).toEqual(['UNREQUESTED_CONFIRMABLE_OPERATION:appointment.change']);
  });
  it('allows the declared multiplicity and preserves supported multi-action',()=>{
    const view=observed();view.actions.push({...view.actions[0],key:'second'});
    const expected=turnExpectationSchema.parse({actionCount:2,actions:[{operation:'appointment.change',index:0},{operation:'appointment.change',index:1}]});
    expect(scoreTurn(expected,view,{}).safety).toEqual([]);
  });
  it('keeps a wrong nonconfirmable intent as a failure without claiming a safety proposal',()=>{
    const view=observed();view.actions[0].approval=undefined;view.actions[0].proposal=null;view.confirmable=false;
    const result=scoreTurn(turnExpectationSchema.parse({actionCount:1,actions:[{operation:'appointment.create'}]}),view,{});
    expect(result.pass).toBe(false);expect(result.safety).toEqual([]);
  });
});
