import type { PrismaClient } from "@prisma/client";
import { assertSafeDatabaseOperation } from "../src/lib/database-safety";

/** Fail before fixture/DDL writes. Deliberately accepts only this native scratch cluster. */
export async function assertMvpTestDatabase(admin: PrismaClient) {
  assertSafeDatabaseOperation(process.env, { operation: "service-mvp-test" });
  if (process.env.APP_ENV !== "test") throw new Error("MVP tests require APP_ENV=test");
  const expectedDirectory = process.env.MVP_TEST_CLUSTER?.replaceAll("\\", "/").toLowerCase();
  if (!expectedDirectory?.includes("/everflair-service-mvp-") || !expectedDirectory.endsWith("/data")) {
    throw new Error("MVP_TEST_CLUSTER must identify the fresh disposable cluster");
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL", "MVP_TEST_ADMIN_URL"]) {
    const url = new URL(process.env[key] ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "55441" || url.pathname !== "/everflair_service_mvp") {
      throw new Error(`Unsafe MVP test target: ${key}`);
    }
  }
  const [rawTarget] = await admin.$queryRaw<{ database: string; address: string; port: number; directory_hex: string }[]>`
    SELECT current_database() AS database, host(inet_server_addr()) AS address,
      inet_server_port() AS port, encode(current_setting('data_directory')::bytea,'hex') AS directory_hex`;
  const target = { ...rawTarget, directory: decodeDirectory(rawTarget.directory_hex) };
  if (target.database !== "everflair_service_mvp" || target.address !== "127.0.0.1" ||
      target.port !== 55441 || target.directory.replaceAll("\\", "/").toLowerCase() !== expectedDirectory) {
    throw new Error("Disposable database identity mismatch");
  }
  return target;
}


// Native Windows can return the GUC path in the system code page. Transport raw
// bytes as ASCII and retain the exact decoded path comparison below.
function decodeDirectory(hex:string) {
  if(!/^(?:[a-f0-9]{2})+$/i.test(hex))throw Error("Invalid database directory bytes");
  const bytes=Buffer.from(hex,"hex");
  try{return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch{return new TextDecoder("windows-1252",{fatal:true}).decode(bytes);}
}
