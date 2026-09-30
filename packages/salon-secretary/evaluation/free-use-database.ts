/** Equivalent local identity/RLS gate; bytea avoids Windows GUC paths containing non-UTF8 bytes. */
import type { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';
import { flaggedRlsTables } from './free-use-technical-writes';
const requireCjs = createRequire(import.meta.url);
const { assertDisposableDirectoryHex } = requireCjs('../../../scripts/local-db-identity.cjs') as { assertDisposableDirectoryHex(hex: string): string };
export function disposableDirectoryFromHex(hex:string){
  // F4: the decision is the shared byte-strict gate of every checkpoint (scripts/local-db-identity.cjs): the RAW bytes end with
  // /everflair-service-mvp-<ASCII [A-Za-z0-9._-], 1-64 bytes>/data; nothing that matches only after a decode is accepted.
  try{assertDisposableDirectoryHex(hex);}catch{throw Error('FREE_USE_DATABASE_DIRECTORY');}
  // Display only: Latin1 preserves every server byte instead of silently dropping malformed UTF8.
  return Buffer.from(hex,'hex').toString('latin1').replaceAll('\\','/');
}
export async function assertFreeUseDatabase(admin:PrismaClient,runtime:PrismaClient){
  const [db]=await admin.$queryRaw<{name:string;host:string;port:number;directory_hex:string}[]>`
    SELECT current_database()::text AS name, host(inet_server_addr()) AS host, inet_server_port() AS port,
      encode(current_setting('data_directory')::bytea,'hex') AS directory_hex`;
  if(db?.name!=='everflair_service_mvp'||db.host!=='127.0.0.1'||db.port!==55441)throw Error('FREE_USE_DATABASE_IDENTITY');
  disposableDirectoryFromHex(db.directory_hex);
  const [role]=await runtime.$queryRaw<{name:string;super:boolean;bypass:boolean}[]>`
    SELECT current_user::text AS name, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
  if(role?.name!=='mvp_service_runtime'||role.super||role.bypass)throw Error('FREE_USE_RUNTIME_ROLE');
  // D1: with SALON_SECRETARY_PERSISTED_STATE / SALON_SECRETARY_NAME_ALIASES on, their 027 tables must be FORCE RLS too.
  const tables=['Salon','Membership','ClientProfile','Service','Professional','WorkingHours','ProfessionalService','Appointment','AppointmentService',
    'AppointmentEvent','AppointmentProduct','Payment','Product','NotificationOutbox','AuditLog','SalonClosure','TimeOff','PhysicalResource','ResourceBooking',...flaggedRlsTables()];
  const flags=await runtime.$queryRaw<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}[]>`
    SELECT relname::text,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY(${tables}::text[])`;
  if(flags.length!==tables.length||flags.some(row=>!row.relrowsecurity||!row.relforcerowsecurity))throw Error('FREE_USE_RLS_FORCE');
  return {host:db.host,port:db.port,database:db.name,runtime_role:role.name,rls_force_tables:flags.length,directoryVerified:true,directoryTransport:'ASCII_HEX'};
}
