/** Local test infrastructure only. No business authority or production permission changes. */
import type { Prisma } from '@prisma/client';
export type Grant = { schema: string; table: string; column: string | null; grantor: string; grantee: string; privilege: string; is_grantable: boolean };
export type GrantSnapshot = { grants: Grant[]; raw: unknown[] };
type Reader = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;
const role = 'mvp_service_runtime';
const tables = ['Product', 'ClientProfile', 'Payment'];
export const temporaryGrants = ['GRANT SELECT ON "public"."Product", "public"."ClientProfile" TO "mvp_service_runtime"', 'GRANT SELECT ("id") ON "public"."Payment" TO "mvp_service_runtime"'];
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
export const canonicalGrants = (grants: Grant[]) => JSON.stringify([...grants].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
export async function snapshotGrants(db: Reader): Promise<GrantSnapshot> {
 const grants = await db.$queryRawUnsafe<Grant[]>(`SELECT n.nspname AS schema,c.relname AS table,NULL::text AS column,pg_get_userbyid(x.grantor) AS grantor,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,x.privilege_type AS privilege,x.is_grantable
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x WHERE n.nspname='public'
 UNION ALL SELECT n.nspname,c.relname,a.attname,pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE n.nspname='public' AND NOT a.attisdropped ORDER BY 1,2,3,4,5,6,7`);
 const raw = await db.$queryRawUnsafe<unknown[]>(`SELECT c.relname AS table_name,'' AS column_name,c.relacl::text AS acl FROM pg_class c WHERE c.relnamespace='public'::regnamespace UNION ALL SELECT c.relname,a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND NOT a.attisdropped AND a.attnum<>0 ORDER BY 1,2`);
 return {grants,raw};
}
/** Only the authorized three SELECT scopes can be introduced; no grant option. */
export function assertTemporaryDelta(before: Grant[], current: Grant[]) {
 const beforeSet=new Set(before.map(g=>JSON.stringify(g))),currentSet=new Set(current.map(g=>JSON.stringify(g)));
 if(before.some(g=>!currentSet.has(JSON.stringify(g))))throw Error('PREEXISTING_GRANT_REMOVED');
 const added=current.filter(g=>!beforeSet.has(JSON.stringify(g)));
 if(added.some(g=>g.schema!=='public'||g.grantee!==role||g.grantor!=='mvp_test_admin'||g.privilege!=='SELECT'||g.is_grantable||!(g.table==='Payment'?g.column==='id':['Product','ClientProfile'].includes(g.table)&&g.column===null)))throw Error('UNAUTHORIZED_GRANT_DELTA');
 return added;
}
/** Restore from BEFORE, including column SELECTs that PostgreSQL removes with table REVOKE. */
export function restoreGrantSql(before: Grant[], current: Grant[]) {
 assertTemporaryDelta(before,current);
 const added=assertTemporaryDelta(before,current),sql:string[]=[];
 for(const grant of added){
  if(!tables.includes(grant.table))throw Error('UNSUPPORTED_TARGET');
  const target=quote(grant.schema)+'.'+quote(grant.table);
  sql.push(`REVOKE SELECT${grant.column===null?'':` (${quote(grant.column)})`} ON ${target} FROM ${quote(role)}`);
  const restore=before.filter(g=>g.schema===grant.schema&&g.table===grant.table&&g.grantee===role&&g.privilege==='SELECT'&&(grant.column===null?g.column!==null:g.column===grant.column));
  for(const prior of restore){
   // Refuse unsupported grant chains before making any changes. Never impersonate a new grantor.
   if(prior.grantor!=='mvp_test_admin')throw Error('UNSUPPORTED_RESTORE_GRANTOR');
   sql.push(`GRANT SELECT (${quote(prior.column!)}) ON ${target} TO ${quote(prior.grantee)}${prior.is_grantable?' WITH GRANT OPTION':''}`);
  }
 }
 return sql;
}
export async function restoreGrants(tx: Prisma.TransactionClient,before: GrantSnapshot) {
 const current=await snapshotGrants(tx),sql=restoreGrantSql(before.grants,current.grants);
 for(const statement of sql)await tx.$executeRawUnsafe(statement);
 const after=await snapshotGrants(tx);
 if(canonicalGrants(before.grants)!==canonicalGrants(after.grants))throw Error('RESTORE_PRIVILEGES_NOT_EXACT');
 return {sql,after,raw_equal:JSON.stringify(before.raw)===JSON.stringify(after.raw)};
}
/** pg_dump adds random restriction keys; preserve original dump and hash structural text separately. */
export const schemaWithoutDumpNonce = (text: string) => text.replace(/^\\(?:un)?restrict .*$/gm,'-- pg_dump nonce');
