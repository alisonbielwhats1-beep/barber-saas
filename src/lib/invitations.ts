import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma, Role } from "@prisma/client";
import { buildInviteEmail } from "./invite-email";
import { defaultMailer, MailDeliveryError, type Mailer } from "./mailer";
import { prisma } from "./prisma";

export const INVITE_TTL_HOURS = 24;

export type InviteRole =
  | "OWNER"
  | "MANAGER"
  | "PROFESSIONAL"
  | "RECEPTIONIST";

export type ProfessionalInviteData = {
  bio?: string | null;
  colorHex?: string | null;
  commissionPct?: number;
  monthlyGoalCents?: number;
  serviceIds?: string[];
};

export type CreateUserInviteInput = {
  salonId: string;
  createdById: string;
  email: string;
  name: string;
  role: InviteRole;
  professional?: ProfessionalInviteData;
};

type CreateUserInviteOptions = {
  now?: Date;
  token?: string;
  mailer?: Mailer;
};

export type InviteRecord = {
  id: string;
  salonId: string;
  email: string;
  userId: string | null;
  role: InviteRole;
  emailVerificationRequired: boolean;
  expiresAt: Date;
  usedAt: Date | null;
};

export type InviteConsumeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "INVALID"
        | "EXPIRED"
        | "USED"
        | "CONFLICT"
        | "VERIFICATION_REQUIRED";
    };

export type InviteClaimResult = "CLAIMED" | "UNAVAILABLE" | "CONFLICT";

export type InviteRepository = {
  findByTokenHash(tokenHash: string): Promise<InviteRecord | null>;
  claimAndActivate(
    invite: InviteRecord,
    now: Date,
  ): Promise<InviteClaimResult>;
};

export type InvitePublicState =
  | "INVALID"
  | "EXPIRED"
  | "USED"
  | "REVOKED"
  | "CREATE_ACCOUNT"
  | "LOGIN_REQUIRED"
  | "WRONG_USER"
  | "ACCEPT";

export type InviteView = {
  state: InvitePublicState;
  salonName?: string;
  invitedName?: string;
  maskedEmail?: string;
  role?: InviteRole;
};

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function errorCode(error: unknown): string {
  if (error instanceof MailDeliveryError) return error.code;
  if (error instanceof Error && error.name === "MailerConfigurationError") {
    return "MAILER_NOT_CONFIGURED";
  }
  return "MAIL_DELIVERY_FAILED";
}

async function markDelivery(
  inviteId: string,
  actorUserId: string,
  tokenHash: string,
  sendAttempt: number,
  result:
    | { ok: true; messageId: string; now: Date }
    | { ok: false; code: string; now: Date },
) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.userInvite.updateMany({
      where: {
        id: inviteId,
        tokenHash,
        sendAttempts: sendAttempt,
        deliveryStatus: "SENDING",
        usedAt: null,
        revokedAt: null,
      },
      data: result.ok
        ? {
            deliveryStatus: "SENT",
            sentAt: result.now,
            providerMessageId: result.messageId,
            lastErrorCode: null,
          }
        : {
            deliveryStatus: "FAILED",
            providerMessageId: null,
            lastErrorCode: result.code,
          },
    });
    if (updated.count !== 1) return false;

    await tx.userInviteEvent.create({
      data: {
        inviteId,
        actorUserId,
        type: result.ok ? "SENT" : "SEND_FAILED",
        details: result.ok
          ? { sendAttempt }
          : { code: result.code, sendAttempt },
      },
    });
    return true;
  });
}

async function deliverInvite(input: {
  inviteId: string;
  actorUserId: string;
  salonName: string;
  invitedName: string;
  email: string;
  role: InviteRole;
  token: string;
  tokenHash: string;
  sendAttempt: number;
  mailer: Mailer;
  now: Date;
}): Promise<"SENT" | "FAILED"> {
  let result:
    | { ok: true; messageId: string; now: Date }
    | { ok: false; code: string; now: Date };

  try {
    const message = buildInviteEmail({
      salonName: input.salonName,
      invitedName: input.invitedName,
      role: input.role,
      token: input.token,
    });
    const sent = await input.mailer.send(
      { ...message, to: input.email },
      {
        idempotencyKey: `invite-${input.inviteId}-attempt-${input.sendAttempt}`,
      },
    );
    result = {
      ok: true,
      messageId: sent.messageId,
      now: input.now,
    };
  } catch (error) {
    result = {
      ok: false,
      code: errorCode(error),
      now: input.now,
    };
  }

  const currentAttempt = await markDelivery(
    input.inviteId,
    input.actorUserId,
    input.tokenHash,
    input.sendAttempt,
    result,
  );
  if (!currentAttempt) return "FAILED";
  return result.ok ? "SENT" : "FAILED";
}

/**
 * Persiste primeiro e envia depois. Se o provedor falhar, o convite continua
 * auditável em FAILED e pode ser reenviado com rotação obrigatória do token.
 */
export async function createUserInvite(
  input: CreateUserInviteInput,
  options?: CreateUserInviteOptions,
): Promise<{
  inviteId: string;
  userId: string | null;
  professionalId: null;
  requiresEmailVerification: boolean;
  expiresAt: Date;
  deliveryStatus: "SENT" | "FAILED";
  recipientEmail: string;
}> {
  if (input.role === "PROFESSIONAL" && !input.professional) {
    throw new Error("Dados profissionais são obrigatórios.");
  }
  if (input.role !== "PROFESSIONAL" && input.professional) {
    throw new Error("Dados profissionais só podem ser usados nessa função.");
  }

  const email = normalizeEmail(input.email);
  const token = options?.token ?? generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const now = options?.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1_000,
  );
  const professional = input.professional;
  const serviceIds = [...new Set(professional?.serviceIds ?? [])];

  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(
        hashtextextended(${`user-invite:${input.salonId}:${email}`}, 0)
      )
    `;

    const salon = await tx.salon.findUnique({
      where: { id: input.salonId },
      select: { name: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado.");

    const creator = await tx.membership.findUnique({
      where: {
        userId_salonId: {
          userId: input.createdById,
          salonId: input.salonId,
        },
      },
      select: { role: true },
    });
    if (!creator || !["OWNER", "MANAGER"].includes(creator.role)) {
      throw new Error("Sem permissão para criar convites.");
    }

    const user = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user) {
      const membership = await tx.membership.findUnique({
        where: {
          userId_salonId: { userId: user.id, salonId: input.salonId },
        },
        select: { id: true },
      });
      if (membership) throw new Error("Esta pessoa já faz parte da equipe.");
      if (input.role === "PROFESSIONAL") {
        const existingProfessional = await tx.professional.findUnique({
          where: { userId: user.id },
          select: { id: true },
        });
        if (existingProfessional) {
          throw new Error(
            "Não foi possível criar o convite para o endereço informado.",
          );
        }
      }
    }

    if (serviceIds.length > 0) {
      const valid = await tx.service.count({
        where: { salonId: input.salonId, id: { in: serviceIds } },
      });
      if (valid !== serviceIds.length) {
        throw new Error("Um ou mais serviços não pertencem a este salão.");
      }
    }

    const previous = await tx.userInvite.findMany({
      where: {
        salonId: input.salonId,
        email: { equals: email, mode: "insensitive" },
        usedAt: null,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (previous.length > 0) {
      await tx.userInvite.updateMany({
        where: { id: { in: previous.map((item) => item.id) } },
        data: { revokedAt: now },
      });
      await tx.userInviteEvent.createMany({
        data: previous.map((item) => ({
          inviteId: item.id,
          actorUserId: input.createdById,
          type: "REVOKED" as const,
          details: { reason: "REPLACED" },
        })),
      });
    }

    const invite = await tx.userInvite.create({
      data: {
        salonId: input.salonId,
        email,
        name: input.name.trim(),
        userId: user?.id ?? null,
        createdById: input.createdById,
        role: input.role,
        emailVerificationRequired: !user,
        tokenHash,
        expiresAt,
        deliveryStatus: "SENDING",
        lastSendAttemptAt: now,
        sendAttempts: 1,
        pendingBio: professional?.bio ?? null,
        pendingColorHex: professional?.colorHex ?? null,
        pendingCommissionPct: professional?.commissionPct,
        pendingMonthlyGoalCents: professional?.monthlyGoalCents,
        pendingServiceIds: serviceIds,
        events: {
          create: {
            actorUserId: input.createdById,
            type: "CREATED",
          },
        },
      },
      select: { id: true },
    });
    return {
      inviteId: invite.id,
      salonName: salon.name,
      userId: user?.id ?? null,
    };
  });

  const deliveryStatus = await deliverInvite({
    ...created,
    actorUserId: input.createdById,
    invitedName: input.name.trim(),
    email,
    role: input.role,
    token,
    tokenHash,
    sendAttempt: 1,
    mailer: options?.mailer ?? defaultMailer,
    now,
  });

  return {
    inviteId: created.inviteId,
    userId: created.userId,
    professionalId: null,
    requiresEmailVerification: created.userId === null,
    expiresAt,
    deliveryStatus,
    recipientEmail: email,
  };
}

export async function resendUserInvite(
  inviteId: string,
  actor: { userId: string; salonId: string },
  options?: { now?: Date; token?: string; mailer?: Mailer },
): Promise<{ deliveryStatus: "SENT" | "FAILED"; expiresAt: Date }> {
  const now = options?.now ?? new Date();
  const token = options?.token ?? generateInviteToken();
  const expiresAt = new Date(
    now.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1_000,
  );

  const invite = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(
        hashtextextended(${`user-invite-id:${inviteId}`}, 0)
      )
    `;
    const actorMembership = await tx.membership.findUnique({
      where: {
        userId_salonId: {
          userId: actor.userId,
          salonId: actor.salonId,
        },
      },
      select: { role: true },
    });
    if (!actorMembership || !["OWNER", "MANAGER"].includes(actorMembership.role)) {
      throw new Error("Convite não disponível para reenvio.");
    }

    let current = await tx.userInvite.findFirst({
      where: {
        id: inviteId,
        salonId: actor.salonId,
        usedAt: null,
        revokedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tokenHash: true,
        salon: { select: { name: true } },
      },
    });
    if (
      !current ||
      current.role === "SUPER_ADMIN" ||
      (current.role !== "PROFESSIONAL" && actorMembership.role !== "OWNER")
    ) {
      throw new Error("Convite não disponível para reenvio.");
    }

    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(
        hashtextextended(
          ${`user-invite:${actor.salonId}:${normalizeEmail(current.email)}`},
          0
        )
      )
    `;
    current = await tx.userInvite.findFirst({
      where: {
        id: inviteId,
        salonId: actor.salonId,
        tokenHash: current.tokenHash,
        usedAt: null,
        revokedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tokenHash: true,
        salon: { select: { name: true } },
      },
    });
    if (!current) throw new Error("Convite não disponível para reenvio.");

    const nextTokenHash = hashInviteToken(token);
    const rotated = await tx.userInvite.updateMany({
      where: {
        id: current.id,
        tokenHash: current.tokenHash,
        usedAt: null,
        revokedAt: null,
      },
      data: {
        tokenHash: nextTokenHash,
        expiresAt,
        deliveryStatus: "SENDING",
        sentAt: null,
        providerMessageId: null,
        lastErrorCode: null,
        lastSendAttemptAt: now,
        sendAttempts: { increment: 1 },
      },
    });
    if (rotated.count !== 1) {
      throw new Error("Convite não disponível para reenvio.");
    }
    const rotationState = await tx.userInvite.findUnique({
      where: { tokenHash: nextTokenHash },
      select: { tokenHash: true, sendAttempts: true },
    });
    if (!rotationState) throw new Error("Convite não disponível para reenvio.");
    await tx.userInviteEvent.create({
      data: {
        inviteId: current.id,
        actorUserId: actor.userId,
        type: "RESENT",
      },
    });
    return {
      id: current.id,
      email: current.email,
      name: current.name,
      role: current.role as InviteRole,
      salonName: current.salon.name,
      tokenHash: rotationState.tokenHash,
      sendAttempt: rotationState.sendAttempts,
    };
  });

  const deliveryStatus = await deliverInvite({
    inviteId: invite.id,
    actorUserId: actor.userId,
    salonName: invite.salonName,
    invitedName: invite.name,
    email: invite.email,
    role: invite.role,
    token,
    tokenHash: invite.tokenHash,
    sendAttempt: invite.sendAttempt,
    mailer: options?.mailer ?? defaultMailer,
    now,
  });
  return { deliveryStatus, expiresAt };
}

export async function revokeUserInvite(
  inviteId: string,
  actor: { userId: string; salonId: string },
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(
        hashtextextended(${`user-invite-id:${inviteId}`}, 0)
      )
    `;
    const actorMembership = await tx.membership.findUnique({
      where: {
        userId_salonId: {
          userId: actor.userId,
          salonId: actor.salonId,
        },
      },
      select: { role: true },
    });
    const current = await tx.userInvite.findFirst({
      where: {
        id: inviteId,
        salonId: actor.salonId,
        usedAt: null,
        revokedAt: null,
      },
      select: { email: true, role: true },
    });
    if (
      !actorMembership ||
      !current ||
      !["OWNER", "MANAGER"].includes(actorMembership.role) ||
      (current.role !== "PROFESSIONAL" && actorMembership.role !== "OWNER")
    ) {
      throw new Error("Convite não disponível para cancelamento.");
    }
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(
        hashtextextended(
          ${`user-invite:${actor.salonId}:${normalizeEmail(current.email)}`},
          0
        )
      )
    `;
    const revoked = await tx.userInvite.updateMany({
      where: {
        id: inviteId,
        salonId: actor.salonId,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    if (revoked.count !== 1) {
      throw new Error("Convite não disponível para cancelamento.");
    }
    await tx.userInviteEvent.create({
      data: {
        inviteId,
        actorUserId: actor.userId,
        type: "REVOKED",
        details: { reason: "CANCELLED_BY_ADMIN" },
      },
    });
  });
}

export async function getInviteView(
  token: string,
  actorUserId?: string | null,
  now = new Date(),
): Promise<InviteView> {
  if (!token || token.length < 20 || token.length > 256) {
    return { state: "INVALID" };
  }
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      name: true,
      email: true,
      role: true,
      userId: true,
      emailVerificationRequired: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      salon: { select: { name: true } },
    },
  });
  if (!invite || invite.role === "SUPER_ADMIN") return { state: "INVALID" };

  const details = {
    salonName: invite.salon.name,
    invitedName: invite.name,
    maskedEmail: maskEmail(invite.email),
    role: invite.role as InviteRole,
  };
  if (invite.revokedAt) return { state: "REVOKED", ...details };
  if (invite.usedAt) return { state: "USED", ...details };
  if (invite.expiresAt <= now) return { state: "EXPIRED", ...details };
  if (invite.emailVerificationRequired || !invite.userId) {
    return { state: "CREATE_ACCOUNT", ...details };
  }
  if (!actorUserId) return { state: "LOGIN_REQUIRED", ...details };
  if (actorUserId !== invite.userId) return { state: "WRONG_USER", ...details };
  return { state: "ACCEPT", ...details };
}

type AcceptanceResult =
  | { ok: true; email: string }
  | {
      ok: false;
      reason:
        | "INVALID"
        | "EXPIRED"
        | "USED"
        | "REVOKED"
        | "WRONG_USER"
        | "CONFLICT";
    };

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function createProfessionalFromInvite(
  tx: Prisma.TransactionClient,
  invite: {
    salonId: string;
    role: Role;
    pendingBio: string | null;
    pendingColorHex: string | null;
    pendingCommissionPct: Prisma.Decimal | null;
    pendingMonthlyGoalCents: number | null;
    pendingServiceIds: string[];
  },
  userId: string,
) {
  if (invite.role !== "PROFESSIONAL") return;
  const serviceIds = [...new Set(invite.pendingServiceIds)];
  if (serviceIds.length > 0) {
    const valid = await tx.service.count({
      where: { salonId: invite.salonId, id: { in: serviceIds }, active: true },
    });
    if (valid !== serviceIds.length) {
      throw new Error("INVITE_SERVICE_CONFLICT");
    }
  }
  const professional = await tx.professional.create({
    data: {
      salonId: invite.salonId,
      userId,
      bio: invite.pendingBio,
      colorHex: invite.pendingColorHex,
      commissionPct: invite.pendingCommissionPct ?? 0,
      monthlyGoalCents: invite.pendingMonthlyGoalCents ?? 0,
      active: true,
    },
    select: { id: true },
  });
  if (serviceIds.length > 0) {
    await tx.professionalService.createMany({
      data: serviceIds.map((serviceId) => ({
        professionalId: professional.id,
        serviceId,
      })),
    });
  }
}

async function acceptInviteTransaction(input: {
  token: string;
  actorUserId?: string;
  passwordHash?: string;
  now: Date;
}): Promise<AcceptanceResult> {
  const tokenHash = hashInviteToken(input.token);
  try {
    return await prisma.$transaction(async (tx) => {
      const invite = await tx.userInvite.findUnique({
        where: { tokenHash },
      });
      if (!invite || invite.role === "SUPER_ADMIN") {
        return { ok: false, reason: "INVALID" } as const;
      }
      if (invite.revokedAt) return { ok: false, reason: "REVOKED" } as const;
      if (invite.usedAt) return { ok: false, reason: "USED" } as const;
      if (invite.expiresAt <= input.now) {
        return { ok: false, reason: "EXPIRED" } as const;
      }

      const isNewAccount =
        invite.emailVerificationRequired || invite.userId === null;
      if (isNewAccount !== Boolean(input.passwordHash)) {
        return { ok: false, reason: "INVALID" } as const;
      }
      if (!isNewAccount && input.actorUserId !== invite.userId) {
        return { ok: false, reason: "WRONG_USER" } as const;
      }

      const claim = await tx.userInvite.updateMany({
        where: {
          id: invite.id,
          tokenHash,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { usedAt: input.now },
      });
      if (claim.count !== 1) return { ok: false, reason: "USED" } as const;

      let userId = invite.userId;
      if (isNewAccount) {
        const existing = await tx.user.findUnique({
          where: { email: invite.email },
          select: { id: true },
        });
        if (existing) throw new Error("INVITE_USER_CONFLICT");
        const user = await tx.user.create({
          data: {
            email: invite.email,
            name: invite.name,
            passwordHash: input.passwordHash!,
            passwordSetAt: input.now,
          },
          select: { id: true },
        });
        userId = user.id;
        await tx.userInvite.update({
          where: { id: invite.id },
          data: {
            userId,
            emailVerificationRequired: false,
          },
        });
      } else {
        const user = await tx.user.findUnique({
          where: { id: userId! },
          select: { email: true },
        });
        if (!user || normalizeEmail(user.email) !== invite.email) {
          throw new Error("INVITE_USER_CONFLICT");
        }
      }

      await tx.membership.create({
        data: {
          userId: userId!,
          salonId: invite.salonId,
          role: invite.role,
        },
      });
      await createProfessionalFromInvite(tx, invite, userId!);
      await tx.userInviteEvent.create({
        data: {
          inviteId: invite.id,
          actorUserId: userId,
          type: "ACCEPTED",
        },
      });
      return { ok: true, email: invite.email } as const;
    });
  } catch (error) {
    if (
      isUniqueConflict(error) ||
      (error instanceof Error &&
        ["INVITE_USER_CONFLICT", "INVITE_SERVICE_CONFLICT"].includes(
          error.message,
        ))
    ) {
      return { ok: false, reason: "CONFLICT" };
    }
    throw error;
  }
}

export async function acceptNewUserInvite(input: {
  token: string;
  password: string;
  now?: Date;
}): Promise<AcceptanceResult> {
  if (!input.token || input.token.length < 20 || input.token.length > 256) {
    return { ok: false, reason: "INVALID" };
  }
  if (input.password.length < 10) {
    return { ok: false, reason: "INVALID" };
  }
  const now = input.now ?? new Date();
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: hashInviteToken(input.token) },
    select: {
      role: true,
      userId: true,
      emailVerificationRequired: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
    },
  });
  if (!invite || invite.role === "SUPER_ADMIN") {
    return { ok: false, reason: "INVALID" };
  }
  if (invite.revokedAt) return { ok: false, reason: "REVOKED" };
  if (invite.usedAt) return { ok: false, reason: "USED" };
  if (invite.expiresAt <= now) return { ok: false, reason: "EXPIRED" };
  if (!invite.emailVerificationRequired && invite.userId) {
    return { ok: false, reason: "INVALID" };
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  return acceptInviteTransaction({
    token: input.token,
    passwordHash,
    now,
  });
}

export async function acceptExistingUserInvite(input: {
  token: string;
  actorUserId: string;
  now?: Date;
}): Promise<AcceptanceResult> {
  if (!input.token || input.token.length < 20 || input.token.length > 256) {
    return { ok: false, reason: "INVALID" };
  }
  return acceptInviteTransaction({
    token: input.token,
    actorUserId: input.actorUserId,
    now: input.now ?? new Date(),
  });
}

const prismaInviteRepository: InviteRepository = {
  async findByTokenHash(tokenHash) {
    const invite = await prisma.userInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        salonId: true,
        email: true,
        userId: true,
        role: true,
        emailVerificationRequired: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (!invite || invite.role === "SUPER_ADMIN") return null;
    return { ...invite, role: invite.role as InviteRole };
  },
  async claimAndActivate(invite, now) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (!invite.userId) return "CONFLICT";
        const claimed = await tx.userInvite.updateMany({
          where: {
            id: invite.id,
            userId: invite.userId,
            emailVerificationRequired: false,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) return "UNAVAILABLE";
        const user = await tx.user.findUnique({
          where: { id: invite.userId },
          select: { email: true },
        });
        if (!user || normalizeEmail(user.email) !== invite.email) {
          throw new Error("INVITE_USER_CONFLICT");
        }
        await tx.membership.create({
          data: {
            userId: invite.userId,
            salonId: invite.salonId,
            role: invite.role,
          },
        });
        return "CLAIMED";
      });
    } catch (error) {
      if (
        isUniqueConflict(error) ||
        (error instanceof Error && error.message === "INVITE_USER_CONFLICT")
      ) {
        return "CONFLICT";
      }
      throw error;
    }
  },
};

// Mantido como unidade isolável para os testes de uso único já existentes.
export async function consumeUserInvite(
  token: string,
  options?: {
    repository?: InviteRepository;
    now?: Date;
    actorUserId?: string | null;
  },
): Promise<InviteConsumeResult> {
  if (!token || token.length > 256) return { ok: false, reason: "INVALID" };
  const now = options?.now ?? new Date();
  const repository = options?.repository ?? prismaInviteRepository;
  const invite = await repository.findByTokenHash(hashInviteToken(token));
  if (!invite) return { ok: false, reason: "INVALID" };
  if (invite.usedAt) return { ok: false, reason: "USED" };
  if (invite.expiresAt <= now) return { ok: false, reason: "EXPIRED" };
  if (invite.emailVerificationRequired || !invite.userId) {
    return { ok: false, reason: "VERIFICATION_REQUIRED" };
  }
  if (options?.actorUserId !== invite.userId) {
    return { ok: false, reason: "INVALID" };
  }
  const claimed = await repository.claimAndActivate(invite, now);
  if (claimed === "CLAIMED") return { ok: true };
  if (claimed === "CONFLICT") return { ok: false, reason: "CONFLICT" };
  return { ok: false, reason: "USED" };
}

export async function getInviteMode(
  token: string,
  actorUserId?: string | null,
): Promise<"ACCEPT" | "LOGIN_REQUIRED" | "VERIFICATION_REQUIRED" | "INVALID"> {
  const view = await getInviteView(token, actorUserId);
  if (view.state === "ACCEPT") return "ACCEPT";
  if (view.state === "LOGIN_REQUIRED" || view.state === "WRONG_USER") {
    return "LOGIN_REQUIRED";
  }
  if (view.state === "CREATE_ACCOUNT") return "VERIFICATION_REQUIRED";
  return "INVALID";
}
