import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import {
  consumeClientPasswordReset,
  hashPasswordResetToken,
} from "@/lib/password-recovery";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slugA = `reset-a-${suffix}`;
const slugB = `reset-b-${suffix}`;
let salonA = "";
let salonB = "";
let clientB = "";

suite("recuperação de senha no PostgreSQL", () => {
  beforeAll(async () => {
    const [a, b] = await Promise.all([
      prisma.salon.create({ data: { slug: slugA, name: "Reset A", accessStatus: "APPROVED" } }),
      prisma.salon.create({ data: { slug: slugB, name: "Reset B", accessStatus: "APPROVED" } }),
    ]);
    salonA = a.id;
    salonB = b.id;
    const tokenHash = hashPasswordResetToken("token-tenant-b");
    const client = await prisma.clientProfile.create({
      data: {
        salonId: salonB,
        name: "Cliente Reset",
        email: `reset-${suffix}@example.test`,
        passwordHash: await bcrypt.hash("senha-antiga", 10),
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    clientB = client.id;
  });

  afterAll(async () => {
    if (salonA || salonB) {
      await prisma.salon.deleteMany({ where: { id: { in: [salonA, salonB].filter(Boolean) } } });
    }
    await prisma.$disconnect();
  });

  it("não consome token de outro salão e o invalida após uso no tenant correto", async () => {
    await expect(consumeClientPasswordReset({
      salonSlug: slugA,
      token: "token-tenant-b",
      password: "senha-nova",
    })).resolves.toBe(false);

    expect((await prisma.clientProfile.findUnique({ where: { id: clientB } }))?.passwordResetTokenHash)
      .toBe(hashPasswordResetToken("token-tenant-b"));

    await expect(consumeClientPasswordReset({
      salonSlug: slugB,
      token: "token-tenant-b",
      password: "senha-nova",
    })).resolves.toBe(true);

    const updated = await prisma.clientProfile.findUniqueOrThrow({ where: { id: clientB } });
    expect(updated.passwordResetTokenHash).toBeNull();
    expect(updated.passwordResetExpiresAt).toBeNull();
    expect(updated.sessionVersion).toBe(1);
    await expect(bcrypt.compare("senha-nova", updated.passwordHash!)).resolves.toBe(true);

    await expect(consumeClientPasswordReset({
      salonSlug: slugB,
      token: "token-tenant-b",
      password: "outra-senha",
    })).resolves.toBe(false);
  });
});
