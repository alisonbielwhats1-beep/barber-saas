import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  acceptExistingUserInvite,
  acceptNewUserInvite,
  createUserInvite,
} from "@/lib/invitations";

const describePostgres =
  process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

describePostgres("convites com PostgreSQL real", () => {
  let suffix: string;
  let salonId: string;
  let ownerId: string;
  let serviceId: string;
  let ownerEmail: string;
  let invitedEmail: string;
  let victimEmail: string;
  let otherSalonId: string;

  const mailer = {
    async send() {
      return { messageId: `message-${suffix}` };
    },
  };

  beforeEach(async () => {
    suffix = crypto.randomUUID();
    ownerEmail = `owner-${suffix}@example.test`;
    invitedEmail = `invited-${suffix}@example.test`;
    victimEmail = `victim-${suffix}@example.test`;
    otherSalonId = "";

    const owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        name: "Owner Integration",
        passwordHash: "integration-only",
        passwordSetAt: new Date(),
      },
      select: { id: true },
    });
    ownerId = owner.id;

    const salon = await prisma.salon.create({
      data: {
        name: `Salon ${suffix}`,
        slug: `salon-${suffix}`,
        memberships: {
          create: { userId: ownerId, role: "OWNER" },
        },
        services: {
          create: {
            name: "Corte",
            durationMin: 30,
            priceCents: 5_000,
          },
        },
      },
      select: {
        id: true,
        services: { select: { id: true } },
      },
    });
    salonId = salon.id;
    serviceId = salon.services[0]!.id;
  });

  afterEach(async () => {
    await prisma.salon.deleteMany({
      where: { id: { in: [salonId, otherSalonId].filter(Boolean) } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, invitedEmail, victimEmail] } },
    });
  });

  it("consome uma vez sob duas aceitações simultâneas", async () => {
    const token = `postgres-token-${suffix}`;
    await createUserInvite(
      {
        salonId,
        createdById: ownerId,
        email: invitedEmail,
        name: "Invited Integration",
        role: "PROFESSIONAL",
        professional: { serviceIds: [serviceId] },
      },
      { token, mailer },
    );

    const results = await Promise.all([
      acceptNewUserInvite({ token, password: "integration-password" }),
      acceptNewUserInvite({ token, password: "integration-password" }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await prisma.membership.count({
        where: { salonId, user: { email: invitedEmail } },
      }),
    ).toBe(1);
    expect(
      await prisma.professional.count({
        where: { salonId, user: { email: invitedEmail } },
      }),
    ).toBe(1);
    expect(
      await prisma.userInviteEvent.count({
        where: { invite: { salonId, email: invitedEmail }, type: "ACCEPTED" },
      }),
    ).toBe(1);
  });

  it("reverte consumo, usuário e membership quando o serviço ficou inválido", async () => {
    const token = `postgres-rollback-token-${suffix}`;
    const created = await createUserInvite(
      {
        salonId,
        createdById: ownerId,
        email: invitedEmail,
        name: "Invited Integration",
        role: "PROFESSIONAL",
        professional: { serviceIds: [serviceId] },
      },
      { token, mailer },
    );
    await prisma.service.update({
      where: { id: serviceId },
      data: { active: false },
    });

    await expect(
      acceptNewUserInvite({ token, password: "integration-password" }),
    ).resolves.toEqual({ ok: false, reason: "CONFLICT" });

    expect(
      await prisma.userInvite.findUnique({
        where: { id: created.inviteId },
        select: { usedAt: true },
      }),
    ).toEqual({ usedAt: null });
    expect(
      await prisma.user.count({ where: { email: invitedEmail } }),
    ).toBe(0);
    expect(
      await prisma.membership.count({ where: { salonId } }),
    ).toBe(1);
    expect(
      await prisma.professional.count({ where: { salonId } }),
    ).toBe(0);
  });

  it("não permite ao owner assumir uma conta global de outro salão", async () => {
    const victim = await prisma.user.create({
      data: {
        email: victimEmail,
        name: "Victim Integration",
        passwordHash: "integration-only",
        passwordSetAt: new Date(),
      },
      select: { id: true },
    });
    const otherSalon = await prisma.salon.create({
      data: {
        name: `Other Salon ${suffix}`,
        slug: `other-salon-${suffix}`,
        memberships: {
          create: { userId: victim.id, role: "PROFESSIONAL" },
        },
        professionals: {
          create: { userId: victim.id },
        },
      },
      select: { id: true },
    });
    otherSalonId = otherSalon.id;

    const token = `postgres-existing-user-token-${suffix}`;
    await createUserInvite(
      {
        salonId,
        createdById: ownerId,
        email: victimEmail,
        name: "Victim Integration",
        role: "MANAGER",
      },
      { token, mailer },
    );

    await expect(
      acceptExistingUserInvite({ token, actorUserId: ownerId }),
    ).resolves.toEqual({ ok: false, reason: "WRONG_USER" });
    expect(
      await prisma.membership.count({
        where: { salonId, userId: victim.id },
      }),
    ).toBe(0);

    await expect(
      createUserInvite(
        {
          salonId,
          createdById: ownerId,
          email: victimEmail,
          name: "Victim Integration",
          role: "PROFESSIONAL",
          professional: { serviceIds: [serviceId] },
        },
        { token: `postgres-cross-tenant-${suffix}`, mailer },
      ),
    ).rejects.toThrow(
      "Não foi possível criar o convite para o endereço informado.",
    );

    await expect(
      acceptExistingUserInvite({ token, actorUserId: victim.id }),
    ).resolves.toEqual({ ok: true, email: victimEmail });
  });
});
