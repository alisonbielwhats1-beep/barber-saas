import {expect,it} from 'vitest';
import {caseSchema} from '../../../packages/salon-secretary/evaluation/free-use-contract';
import {emptyMetrics,observeView,scoreMissingQuestion} from '../../../packages/salon-secretary/evaluation/free-use-score';
it('retains failed follow-up without counting a prior question or lost context twice',()=>{
 const turn=caseSchema.parse({id:'unobserved',family:'conditional',criterion:'do not invent observations',turns:[{message:'an answer that was never sent',when:{missingAny:['time']},expect:{}}]}).turns[0];
 for(const previous of [undefined,observeView({message:'prior question',action_plan:{actions:[]}})]){
  const score=scoreMissingQuestion(turn,previous);expect(score.pass).toBe(false);expect(score.failures).toEqual(['EXPECTED_QUESTION_NOT_ASKED']);expect(score.metrics).toEqual(emptyMetrics());expect(score.safety).toEqual([]);
 }
});
