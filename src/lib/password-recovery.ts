import "server-only";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { withSalonBySlug } from "./prisma-tenant";
import { defaultMailer, type Mailer } from "./mailer";
import { buildPasswordResetEmail } from "./password-reset-email";
import { passwordRecoveryEmailEnabled } from "./password-recovery-feature";

const RESET_WINDOW_MS = 60 * 60 * 1_000;

export function createPasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function issueAdminPasswordReset(input: {
  email: string;
  now?: Date;
  mailer?: Mailer;
}): Promise<void> {
  if (!passwordRecoveryEmailEnabled()) return;
  const now = input.now ?? new Date();
  const token = createPasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true },
  });
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: new Date(now.getTime() + RESET_WINDOW_MS),
    },
  });

  try {
    const message = buildPasswordResetEmail({
      recipientName: user.name,
      token,
    });
    await (input.mailer ?? defaultMailer).send(
      { ...message, to: user.email },
      { idempotencyKey: `password-reset-admin-${tokenHash}` },
    );
  } catch {
    await prisma.user.updateMany({
      where: { id: user.id, passwordResetTokenHash: tokenHash },
      data: { passwordResetTokenHash: null, passwordResetExpiresAt: null },
    });
  }
}

export async function issueClientPasswordReset(input: {
  salonSlug: string;
  email: string;
  now?: Date;
  mailer?: Mailer;
}): Promise<void> {
  if (!passwordRecoveryEmailEnabled()) return;
  const now = input.now ?? new Date();
  const token = createPasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);
  const found = await withSalonBySlug(input.salonSlug, async (tx, salonId) => {
    const [salon, client] = await Promise.all([
      tx.salon.findUnique({ where: { id: salonId }, select: { name: true } }),
      tx.clientProfile.findFirst({
        where: {
          salonId,
          email: input.email,
          mergedIntoId: null,
          passwordHash: { not: null },
        },
        select: { id: true, name: true, email: true },
      }),
    ]);
    if (!salon || !client?.email) return null;
    await tx.clientProfile.update({
      where: { id: client.id },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(now.getTime() + RESET_WINDOW_MS),
      },
    });
    return { salonId, salonName: salon.name, client };
  });
  if (!found) return;

  try {
    const message = buildPasswordResetEmail({
      recipientName: found.client.name,
      token,
      salonName: found.salonName,
      salonSlug: input.salonSlug,
    });
    await (input.mailer ?? defaultMailer).send(
      { ...message, to: found.client.email! },
      { idempotencyKey: `password-reset-client-${tokenHash}` },
    );
  } catch {
    await withSalonBySlug(input.salonSlug, (tx, salonId) =>
      tx.clientProfile.updateMany({
        where: {
          id: found.client.id,
          salonId,
          passwordResetTokenHash: tokenHash,
        },
        data: { passwordResetTokenHash: null, passwordResetExpiresAt: null },
      }),
    );
  }
}

export async function consumeAdminPasswordReset(input: {
  token: string;
  password: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const result = await prisma.user.updateMany({
    where: {
      passwordResetTokenHash: hashPasswordResetToken(input.token),
      passwordResetExpiresAt: { gt: now },
    },
    data: {
      passwordHash,
      passwordSetAt: now,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      sessionVersion: { increment: 1 },
    },
  });
  return result.count === 1;
}

export async function consumeClientPasswordReset(input: {
  salonSlug: string;
  token: string;
  password: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const result = await withSalonBySlug(input.salonSlug, (tx, salonId) =>
    tx.clientProfile.updateMany({
      where: {
        salonId,
        mergedIntoId: null,
        passwordResetTokenHash: hashPasswordResetToken(input.token),
        passwordResetExpiresAt: { gt: now },
      },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        sessionVersion: { increment: 1 },
      },
    }),
  );
  return result?.count === 1;
}
