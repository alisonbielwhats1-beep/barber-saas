/** Explicit offline migration. Dry-run by default; never loads production environment files. */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient, type Prisma } from "@prisma/client";
import { withSalon } from "../src/lib/prisma-tenant";
import { assertSafeDatabaseOperation } from "../src/lib/database-safety";
import { prisma as tenantDb } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");
const production = process.env.APP_ENV === "production";
if (production) {
  // A deployment authorization does not substitute for this migration's approval/backup.
  if (process.env.AUTH_MIGRATION_APPROVAL !== "APPROVED_IDENTITY_IMPORT_WITH_BACKUP" ||
      !process.env.AUTH_MIGRATION_BACKUP_REFERENCE ||
      !process.env.SUPABASE_PROJECT_REF ||
      new URL(process.env.SUPABASE_URL ?? "").hostname !== `${process.env.SUPABASE_PROJECT_REF}.supabase.co`) {
    throw new Error("Explicit migration approval, target and verified backup reference required");
  }
  for (const value of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    if (!value) throw new Error("Both database targets must be identified");
    const dbUrl = new URL(value);
    const ref = process.env.SUPABASE_PROJECT_REF;
    if (!["postgres:", "postgresql:"].includes(dbUrl.protocol) ||
        !(dbUrl.hostname === `db.${ref}.supabase.co` ||
          (dbUrl.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(dbUrl.username).endsWith(`.${ref}`)))) {
      throw new Error("Database and Auth production project differ");
    }
  }
} else {
  assertSafeDatabaseOperation(process.env, { operation: "auth-identity-import" });
  const url = new URL(process.env.SUPABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && process.env.APP_ENV !== "staging") {
    throw new Error("Nonproduction migration cannot access hosted Auth");
  }
}

const db = new PrismaClient({ log: [] });
type Source = { kind: "user" | "client"; id: string; salonId?: string; email: string; passwordHash: string; authIdentityId: string | null };
async function main() {
  const sources: Source[] = [];
  const users = await db.user.findMany({ select: { id: true, email: true, passwordHash: true, authIdentityId: true } });
  for (const user of users) if (user.passwordHash) sources.push({ ...user, passwordHash: user.passwordHash, kind: "user" });
  // Offline inventory only. All client reads/writes set the same tenant GUC as withSalon.
  const salons = await db.salon.findMany({ select: { id: true } });
  for (const salon of salons) {
    const profiles = await withSalon(salon.id, async tx => {
      return tx.clientProfile.findMany({ where: { salonId: salon.id, passwordHash: { not: null }, mergedIntoId: null },
        select: { id: true, salonId: true, email: true, passwordHash: true, authIdentityId: true } });
    });
    for (const profile of profiles) {
      if (!profile.email || !profile.passwordHash) throw new Error("Account without email requires manual review");
      sources.push({ ...profile, email: profile.email, passwordHash: profile.passwordHash, kind: "client" });
    }
  }
  const groups = new Map<string, Source[]>();
  for (const source of sources) {
    const email = source.email.trim().toLowerCase();
    groups.set(email, [...(groups.get(email) ?? []), source]);
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", accounts: sources.length, identities: groups.size,
    sharedEmails: [...groups.values()].filter(group => group.length > 1).length,
    linkedAccounts: sources.filter(source => source.authIdentityId).length }));
  if (!apply) return;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Migration-only service role is required");
  const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  for (const [email, group] of groups) {
    // Stable provider user ID permits retry without matching unrelated accounts by email.
    const hex = createHash("sha256").update(`everflair-auth-v1:${process.env.SUPABASE_URL}:${email}`).digest("hex");
    const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
    if (group.some(source => source.authIdentityId && source.authIdentityId !== id)) throw new Error("Mapping conflict; manual review required");
    const existing = await auth.auth.admin.getUserById(id);
    if (existing.data.user) {
      if (existing.data.user.app_metadata.migration !== "everflair-auth-v1" || existing.data.user.email !== email) throw new Error("Provider identity conflict");
    } else {
      const { error } = await auth.auth.admin.createUser({ id, email,
        // Legacy email ownership was not verified. Recovery/confirmation proves ownership.
        email_confirm: false,
        ...(group.length === 1 ? { password_hash: group[0].passwordHash } : {}),
        app_metadata: { migration: "everflair-auth-v1" } });
      if (error) throw new Error("Provider import failed; no credentials or account details logged");
    }
    await db.authIdentity.upsert({ where: { id }, create: { id }, update: {} });
    for (const source of group) {
      const linkSource = async (tx: Prisma.TransactionClient) => {
        const result = source.kind === "user"
          ? await tx.user.updateMany({ where: { id: source.id, email: source.email, passwordHash: source.passwordHash,
              OR: [{ authIdentityId: null }, { authIdentityId: id }] }, data: { authIdentityId: id } })
          : await tx.clientProfile.updateMany({ where: { id: source.id, salonId: source.salonId, email: source.email,
              passwordHash: source.passwordHash, mergedIntoId: null, OR: [{ authIdentityId: null }, { authIdentityId: id }] },
              data: { authIdentityId: id } });
        if (result.count !== 1) throw new Error("Source changed during import; manual review required");
      };
      if (source.salonId) await withSalon(source.salonId, linkSource);
      else await db.$transaction(linkSource);
    }
  }
  console.log("Identity import completed. Credentials/history preserved. Provider activation is a separate step.");
}
main().catch(() => { console.error("Identity import stopped. Review the approved target and migration state; no automatic rollback performed."); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); await tenantDb.$disconnect(); });
