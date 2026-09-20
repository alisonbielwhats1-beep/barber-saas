import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { withSalon, withSalonBySlug } from "./prisma-tenant";
import { createAuthAdminClient } from "./supabase-auth";

/** Provisioning never changes old hashes, profile links or sessions. */
export async function prepareLegacyRecovery(email: string, salonSlug?: string) {
  const account = salonSlug
    ? await withSalonBySlug(salonSlug, (tx, salonId) => tx.clientProfile.findFirst({
        where: { salonId, email: { equals: email, mode: "insensitive" }, passwordHash: { not: null }, authIdentityId: null, mergedIntoId: null }, select: { id: true } }))
    : await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, passwordHash: { not: null }, authIdentityId: null }, select: { id: true } });
  if (!account) return;
  const identity = await prisma.authIdentity.upsert({ where: { email }, create: { id: randomUUID(), email }, update: {} });
  const client = createAuthAdminClient();
  const existing = await client.auth.admin.getUserById(identity.id);
  if (existing.data.user) {
    if (existing.data.user.email?.toLowerCase() !== email) throw new Error("IDENTITY_EMAIL_CONFLICT");
    return;
  }
  if (existing.error?.status !== 404) throw new Error("IDENTITY_LOOKUP_FAILED");
  // No password is copied/generated and no ownership is falsely confirmed.
  const created = await client.auth.admin.createUser({ id: identity.id, email, email_confirm: false,
    app_metadata: { migration: "voluntary-recovery-v1" } });
  if (created.error) {
    // Another request may have provisioned the same reserved UUID concurrently.
    const retry = await client.auth.admin.getUserById(identity.id);
    if (retry.error || retry.data.user?.email?.toLowerCase() !== email) throw new Error("IDENTITY_PROVISION_FAILED");
  }
}

/** Called only after verifyOtp proved mailbox ownership and updateUser succeeded.
 * Changes credential references, never user/profile IDs, reservations or history.
 * Every tenant update shares the outer transaction but sets its own salon GUC.
 */
export async function completeRecoveryMigration(identityId: string, verifiedEmail: string, version: number) {
  const email = verifiedEmail.trim().toLowerCase();
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AuthIdentity" WHERE id = ${identityId}::uuid FOR UPDATE`;
    const identity = await tx.authIdentity.findUniqueOrThrow({ where: { id: identityId } });
    if (identity.sessionVersion !== version || (identity.email && identity.email !== email)) throw new Error("IDENTITY_CHANGED");
    const credentials = { authIdentityId: identityId, passwordHash: null, passwordResetTokenHash: null,
      passwordResetExpiresAt: null, sessionVersion: { increment: 1 } };
    await tx.user.updateMany({ where: { OR: [
      { authIdentityId: identityId },
      { authIdentityId: null, email: { equals: email, mode: "insensitive" }, passwordHash: { not: null } },
    ] }, data: credentials });
    const salons = await tx.salon.findMany({ select: { id: true } });
    for (const salon of salons) {
      await withSalon(salon.id, scoped => scoped.clientProfile.updateMany({ where: { salonId: salon.id, mergedIntoId: null, OR: [
        { authIdentityId: identityId },
        { authIdentityId: null, email: { equals: email, mode: "insensitive" }, passwordHash: { not: null } },
      ] }, data: credentials }), tx);
    }
    await tx.authIdentity.update({ where: { id: identityId }, data: { email } });
  }, { timeout: 20_000 });
}
