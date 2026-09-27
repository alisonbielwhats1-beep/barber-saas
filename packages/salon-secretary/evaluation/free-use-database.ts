/** Equivalent local identity/RLS gate; bytea avoids Windows GUC paths containing non-UTF8 bytes. */
import type { PrismaClient } from '@prisma/client';
export function disposableDirectoryFromHex(hex:string){
  if(!/^(?:[a-f0-9]{2})+$/i.test(hex))throw Error('FREE_USE_DATABASE_DIRECTORY');
  // Only the ASCII suffix is authority here, exactly as the historical local gate.
  // Latin1 preserves every server byte instead of silently dropping malformed UTF8.
  const directory=Buffer.from(hex,'hex').toString('latin1').replaceAll('\\','/');
  if(!/\/everflair-service-mvp-[^/]+\/data$/i.test(directory))throw Error('FREE_USE_DATABASE_DIRECTORY');
  return directory;
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
  const tables=['Salon','Membership','ClientProfile','Service','Professional','WorkingHours','ProfessionalService','Appointment','AppointmentService',
    'AppointmentEvent','AppointmentProduct','Payment','Product','NotificationOutbox','AuditLog','SalonClosure','TimeOff','PhysicalResource','ResourceBooking'];
  const flags=await runtime.$queryRaw<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}[]>`
    SELECT relname::text,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY(${tables}::text[])`;
  if(flags.length!==tables.length||flags.some(row=>!row.relrowsecurity||!row.relforcerowsecurity))throw Error('FREE_USE_RLS_FORCE');
  return {host:db.host,port:db.port,database:db.name,runtime_role:role.name,rls_force_tables:flags.length,directoryVerified:true,directoryTransport:'ASCII_HEX'};
}
