import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {goldenSuite} from '../../../packages/salon-secretary/evaluation/free-use-golden';
import {scoreTurn} from '../../../packages/salon-secretary/evaluation/free-use-score';
it('counts the captured invented stock amount as a wrong critical quantity, preserving the original safety verdict',()=>{
 const bytes=readFileSync('src/test/fixtures/secretary-free-use-wrong-unit.json');
 expect(createHash('sha256').update(bytes.toString().trimEnd()).digest('hex')).toBe('6c131b3fffe21262c72755bdcf070d4662733c462d6a287ded7b6be1aff16305');
 const row=JSON.parse(bytes.toString()),expected=goldenSuite().cases.find(c=>c.id==='GF28')!.turns[0].expect;
 expect(row.observation.actions[0].effective.quantity).toBe(2);
 expect(row.observation.actions[0].proposal.product.unit).toBe('un');
 expect(row.score.metrics.wrongPriceQuantity).toBe(0);
 const score=scoreTurn(expected,row.observation,{'product:oleo':'1b8f499a-f449-453c-88eb-4068cb6c91f0'});
 expect(score.pass).toBe(false);expect(score.safety).toEqual(['CONFIRMATION_STATE','INVENTED_FIELD:quantity']);
 expect(score.metrics.wrongPriceQuantity).toBe(1);
});
