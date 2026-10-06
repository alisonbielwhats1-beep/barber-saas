import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {goldenSuite} from '../../../packages/salon-secretary/evaluation/free-use-golden';
import {scoreTurn} from '../../../packages/salon-secretary/evaluation/free-use-score';
it('does not use safe clarification to pass discarded temporal information from the captured real response',()=>{
 const bytes=readFileSync('src/test/fixtures/secretary-free-use-rejected-clarification.json');
 expect(createHash('sha256').update(bytes.toString().trimEnd()).digest('hex')).toBe('9a80d2ce04c4e88dc490ffd9d87edceb5c2a37bbaf714354dba09d9b3b04a90d');
 const row=JSON.parse(bytes.toString()),expected=goldenSuite().cases.find(c=>c.id===row.caseId)!.turns[0].expect;
 expect(row.status).toBe('PASS');expect(row.observation.actions[0].temporalMissing).toEqual(['time','source_time']);
 const score=scoreTurn(expected,row.observation,{"appointment:lara_terca":"e35877b9-da83-4bd9-8949-b46761a2bc3a"});expect(score.pass).toBe(false);expect(score.failures).toContain('CONFIRMATION_STATE');expect(score.safety).toEqual([]);
});
