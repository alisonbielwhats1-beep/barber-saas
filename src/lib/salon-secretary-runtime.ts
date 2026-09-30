import "server-only";
import { createPaidModel, multiActionConfiguration } from "@everflair/salon-secretary";
import { SalonSecretary } from "./salon-secretary";
import { persistedSessionStore } from "./secretary-session-store";
import { assertSafeDatabaseOperation } from "./database-safety";
import { isSecretaryCodespaceTarget } from "./secretary-staging-target.mjs";

export function assertSecretaryEnvironment() {
  if (process.env.SALON_SECRETARY_ENABLED !== "true" ||
      !["development", "test", "staging"].includes(process.env.APP_ENV ?? "") ||
      process.env.VERCEL_ENV === "production") throw new Error("SECRETARY_DISABLED");
  if (process.env.APP_ENV === "staging") {
    if (!isSecretaryCodespaceTarget(process.env)) throw new Error("SECRETARY_STAGING_TARGET_REQUIRED");
    return;
  }
  const target = assertSafeDatabaseOperation(process.env, { operation: "salon-secretary-mvp2" });
  if (target.target !== "local") throw new Error("SECRETARY_LOCAL_ONLY");
  // Narrower than the general repository gate: only the identified disposable MVP database.
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    const url = new URL(process.env[name] ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "55441" || url.pathname !== "/everflair_service_mvp")
      throw new Error("SECRETARY_DISPOSABLE_DATABASE_REQUIRED");
  }
}
// Separate from HQ; no SDK-global model, key, tracing or session setters.
async function secretaryModel() {
  if (process.env.SECRETARY_FRONT_E2E_SCRIPT) {
    assertSecretaryEnvironment();
    if (process.env.APP_ENV !== 'test' || process.env.SALON_SECRETARY_ALLOW_PAID_CALLS !== 'false') throw Error('SCRIPTED_MODEL_TEST_ONLY');
    return (await import('../test/secretary-front-model')).frontTestModel();
  }
  return createPaidModel(process.env);
}
export const salonSecretary = new SalonSecretary(secretaryModel, undefined, undefined, {
  enabled: () => process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED === "true",
  paidCallsAllowed: () => process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === "true",
  credential: () => process.env.TYPESAFE_API_KEY,
  transport: (url, init) => fetch(url, init),
}, {
  enabled: () => process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED === "true",
  policy: () => multiActionConfiguration(process.env).policy,
// D1: SALON_SECRETARY_PERSISTED_STATE (default off) keeps conversations in PostgreSQL (027) instead of this process only.
}, persistedSessionStore);
