import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { assertSafeDatabaseOperation } from "../database-safety";
import { completeRecoveryMigration } from "../legacy-supabase-transition";
import { withSalon } from "../prisma-tenant";

const suite = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
suite("voluntary identity transition preserves existing tenant records", () => {
  const id = randomUUID(); const email = `${id}@example.test`;
  const salons: string[] = []; const clients: string[] = []; let ownerId = "";
  beforeAll(async () => {
    assertSafeDatabaseOperation(process.env, { operation: "voluntary-auth-transition-test" });
    await prisma.authIdentity.create({ data: { id, email } });
    ownerId = (await prisma.user.create({ data: { email, name: "Existing owner", passwordHash: "owner-old-hash", sessionVersion: 4 } })).id;
    for (let index = 0; index < 3; index++) {
      const salon = await prisma.salon.create({ data: { name: `Transition ${index}`, slug: `transition-${id}-${index}`, accessStatus: "APPROVED" } });
      salons.push(salon.id);
      const profile = await withSalon(salon.id, tx => tx.clientProfile.create({ data: { salonId: salon.id, name: `Preserve ${index}`, email,
        passwordHash: index < 2 ? `client-old-hash-${index}` : null, notes: "Preserve history", phone: "11911112222", sessionVersion: 2 } }));
      clients.push(profile.id);
    }
  });
  afterAll(async () => {
    for (const salonId of salons) await prisma.salon.delete({ where: { id: salonId } });
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
    await prisma.authIdentity.delete({ where: { id } });
    await prisma.$disconnect();
  });
  it("rejects stale recovery without changing any credential mapping", async () => {
    await expect(completeRecoveryMigration(id, email, 99)).rejects.toThrow("IDENTITY_CHANGED");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash).toBe("owner-old-hash");
  });
  it("links registered accounts atomically, preserves IDs and customer data, and excludes guests", async () => {
    await completeRecoveryMigration(id, email, 0);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(owner).toMatchObject({ id: ownerId, authIdentityId: id, email, name: "Existing owner", passwordHash: null, sessionVersion: 5 });
    for (let index = 0; index < clients.length; index++) {
      const profile = await withSalon(salons[index], tx => tx.clientProfile.findUniqueOrThrow({ where: { id: clients[index] } }));
      expect(profile).toMatchObject({ id: clients[index], salonId: salons[index], name: `Preserve ${index}`, notes: "Preserve history", phone: "11911112222", email });
      expect(profile.authIdentityId).toBe(index < 2 ? id : null);
      expect(profile.sessionVersion).toBe(index < 2 ? 3 : 2);
    }
  });
});
