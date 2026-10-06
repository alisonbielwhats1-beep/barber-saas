import {describe,it,expect} from 'vitest';
import {restoreGrantSql,canonicalGrants,assertTemporaryDelta,schemaWithoutDumpNonce,type Grant} from '../../test/secretary-grant-state';
const g=(table:string,column:string|null=null,extra:Partial<Grant>={}):Grant=>({schema:'public',table,column,grantor:'mvp_test_admin',grantee:'mvp_service_runtime',privilege:'SELECT',is_grantable:false,...extra});
// Independent PostgreSQL REVOKE semantics model: table REVOKE erases same-privilege column ACLs too.
function restore(before:Grant[],current:Grant[]){let state=[...current];for(const sql of restoreGrantSql(before,current)){
 const table=sql.match(/ON "public"\."([^"]+)"/)![1],column=sql.match(/SELECT \("([^"]+)"\)/)?.[1]??null;
 if(sql.startsWith('REVOKE'))state=state.filter(p=>!(p.table===table&&p.privilege==='SELECT'&&(column===null||p.column===column)));
 else state.push(g(table,column,{is_grantable:sql.endsWith('WITH GRANT OPTION')}));
 }return state;}
describe('snapshot-based local grant restoration',()=>{
 it.each([
  ['A absent',[],[g('Payment','id')]],
  ['B existing table',[g('Product')],[g('Product')]],
  ['C existing column',[g('Product','id'),g('Product','stock')],[g('Product','id'),g('Product','stock'),g('Product')]],
  ['D mixed',[g('Product'),g('Product','stock',{privilege:'UPDATE'}),g('ClientProfile','id')],[g('Product'),g('Product','stock',{privilege:'UPDATE'}),g('ClientProfile','id'),g('ClientProfile')]],
  ['F partial apply',[g('Product','id')],[g('Product','id'),g('Product')]],
 ] as [string,Grant[],Grant[]][])('%s restores exact privilege metadata and E repeat is idempotent',(_name,before,current)=>{
  const result=restore(before,current);expect(canonicalGrants(result)).toBe(canonicalGrants(before));expect(restoreGrantSql(before,result)).toEqual([]);
 });
 it('preserves preexisting grant option on columns',()=>{const b=[g('Product','id',{is_grantable:true})];expect(restore(b,[...b,g('Product')])).toEqual(b);});
 it('rejects unapproved privilege, table, grantee, grantor or delegation before SQL',()=>{
  for(const extra of [{privilege:'UPDATE'},{table:'Service'},{grantee:'PUBLIC'},{grantor:'other'},{is_grantable:true}])expect(()=>assertTemporaryDelta([],[g('Product',null,extra)])).toThrow('UNAUTHORIZED_GRANT_DELTA');
 });
 it('refuses a missing preexisting privilege',()=>expect(()=>restoreGrantSql([g('Product','id')],[g('Product')])).toThrow('PREEXISTING_GRANT_REMOVED'));
 it('compares schema independently of pg_dump session nonce',()=>{expect(schemaWithoutDumpNonce('\\restrict aaa\nCREATE TABLE x();\n\\unrestrict aaa')).toBe(schemaWithoutDumpNonce('\\restrict bbb\nCREATE TABLE x();\n\\unrestrict bbb'));expect(schemaWithoutDumpNonce('CREATE TABLE x();')).not.toBe(schemaWithoutDumpNonce('CREATE TABLE y();'));});
});
