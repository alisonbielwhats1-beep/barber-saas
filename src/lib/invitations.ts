import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

export const INVITE_TTL_HOURS = 24;

export type InviteRole =
  | "OWNER"
  | "MANAGER"
  | "PROFESSIONAL"
  | "RECEPTIONIST";

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

export type ProfessionalInviteData = {
  bio?: string | null;
  colorHex?: string | null;
  commissionPct?: number;
  monthlyGoalCents?: number;
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
};

class InviteActivationConflictError extends Error {
  constructor() {
    super("Invite activation conflicts with current persistence state");
    this.name = "InviteActivationConflictError";
  }
}

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Conta inexistente não é materializada: o convite fica explicitamente
 * bloqueado até existir verificação real de e-mail. Conta existente recebe um
 * vínculo pendente que só o próprio usuário autenticado pode aceitar.
 */
export async function createUserInvite(
  input: CreateUserInviteInput,
  options?: CreateUserInviteOptions,
): Promise<{
  userId: string | null;
  professionalId: string | null;
  token: string;
  expiresAt: Date;
  requiresEmailVerification: boolean;
}> {
  if (input.role === "PROFESSIONAL" && !input.professional) {
    throw new Error("Professional data is required for a PROFESSIONAL invite");
  }
  if (input.role !== "PROFESSIONAL" && input.professional) {
    throw new Error("Professional data is only valid for a PROFESSIONAL invite");
  }

  const email = input.email.toLowerCase().trim();
  const token = options?.token ?? generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const now = options?.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1_000,
  );

  const result = await prisma.$transaction(async (tx) => {
    const lockedEmails = await tx.$queryRaw<Array<{ locked: number }>>`
      WITH invite_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`user-invite:${email}`}, 0)
        )
      )
      SELECT 1::int AS "locked" FROM invite_lock
    `;
    if (lockedEmails.length !== 1) {
      throw new Error("Não foi possível bloquear o e-mail do convite.");
    }

    const user = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });

    let professionalId: string | null = null;
    if (user) {
      const membership = await tx.membership.findUnique({
        where: {
          userId_salonId: {
            userId: user.id,
            salonId: input.salonId,
          },
        },
        select: { id: true },
      });
      if (membership) {
        throw new Error("Esta pessoa já faz parte da equipe.");
      }

      if (input.role === "PROFESSIONAL" && input.professional) {
        const existingProfessional = await tx.professional.findUnique({
          where: { userId: user.id },
          select: { id: true, salonId: true, active: true },
        });

        if (existingProfessional?.salonId !== undefined) {
          if (existingProfessional.salonId !== input.salonId) {
            throw new Error(
              "Esta conta já é profissional em outro estabelecimento.",
            );
          }
          if (existingProfessional.active) {
            throw new Error("O perfil profissional já está ativo.");
          }
          professionalId = existingProfessional.id;
        } else {
          const professional = await tx.professional.create({
            data: {
              salonId: input.salonId,
              userId: user.id,
              bio: input.professional.bio ?? null,
              colorHex: input.professional.colorHex ?? null,
              commissionPct: input.professional.commissionPct ?? 0,
              monthlyGoalCents: input.professional.monthlyGoalCents ?? 0,
              active: false,
            },
            select: { id: true },
          });
          professionalId = professional.id;
        }
      }
    }

    await tx.userInvite.updateMany({
      where: {
        salonId: input.salonId,
        email,
        usedAt: null,
      },
      data: { usedAt: now },
    });

    await tx.userInvite.create({
      data: {
        salonId: input.salonId,
        email,
        name: input.name,
        userId: user?.id ?? null,
        createdById: input.createdById,
        role: input.role,
        emailVerificationRequired: !user,
        tokenHash,
        expiresAt,
      },
    });

    return {
      userId: user?.id ?? null,
      professionalId,
      requiresEmailVerification: !user,
    };
  });

  return { ...result, token, expiresAt };
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
        if (invite.emailVerificationRequired || !invite.userId) {
          throw new InviteActivationConflictError();
        }

        const claimed = await tx.userInvite.updateMany({
          where: {
            id: invite.id,
            userId: invite.userId,
            emailVerificationRequired: false,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) return "UNAVAILABLE";

        const user = await tx.user.findUnique({
          where: { id: invite.userId },
          select: { email: true },
        });
        if (!user || user.email.toLowerCase() !== invite.email) {
          throw new InviteActivationConflictError();
        }

        const membership = await tx.membership.findUnique({
          where: {
            userId_salonId: {
              userId: invite.userId,
              salonId: invite.salonId,
            },
          },
          select: { id: true },
        });
        if (membership) throw new InviteActivationConflictError();

        if (invite.role === "PROFESSIONAL") {
          const professionalCount = await tx.professional.count({
            where: {
              userId: invite.userId,
              salonId: invite.salonId,
            },
          });
          if (professionalCount !== 1) {
            throw new InviteActivationConflictError();
          }
        }

        await tx.membership.create({
          data: {
            userId: invite.userId,
            salonId: invite.salonId,
            role: invite.role,
          },
        });

        if (invite.role === "PROFESSIONAL") {
          const activated = await tx.professional.updateMany({
            where: {
              userId: invite.userId,
              salonId: invite.salonId,
              active: false,
            },
            data: { active: true },
          });
          if (activated.count !== 1) {
            throw new InviteActivationConflictError();
          }
        }

        return "CLAIMED";
      });
    } catch (error) {
      if (
        error instanceof InviteActivationConflictError ||
        isPrismaUniqueConflict(error)
      ) {
        return "CONFLICT";
      }
      throw error;
    }
  },
};

export async function consumeUserInvite(
  token: string,
  options?: {
    repository?: InviteRepository;
    now?: Date;
    actorUserId?: string | null;
  },
): Promise<InviteConsumeResult> {
  if (!token || token.length > 256) return { ok: false, reason: "INVALID" };

  const repository = options?.repository ?? prismaInviteRepository;
  const now = options?.now ?? new Date();
  const invite = await repository.findByTokenHash(hashInviteToken(token));

  if (!invite) return { ok: false, reason: "INVALID" };
  if (invite.usedAt) return { ok: false, reason: "USED" };
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "EXPIRED" };
  }
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
): Promise<
  "ACCEPT" | "LOGIN_REQUIRED" | "VERIFICATION_REQUIRED" | "INVALID"
> {
  if (!token || token.length > 256) return "INVALID";
  const invite = await prismaInviteRepository.findByTokenHash(
    hashInviteToken(token),
  );
  const now = new Date();
  if (!invite || invite.usedAt || invite.expiresAt <= now) return "INVALID";
  if (invite.emailVerificationRequired || !invite.userId) {
    return "VERIFICATION_REQUIRED";
  }
  return actorUserId === invite.userId ? "ACCEPT" : "LOGIN_REQUIRED";
}
