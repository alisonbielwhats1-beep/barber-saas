"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";
import {
  createUserInvite,
  resendUserInvite,
  revokeUserInvite,
} from "@/lib/invitations";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const professionalInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  bio: z.string().optional().nullable(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  commissionPct: z.coerce.number().min(0).max(100).default(0),
  monthlyGoalCents: z.coerce.number().int().min(0).default(0),
  serviceIds: z.array(z.string().min(1)).max(100).default([]),
});

export type ProfessionalInput = z.infer<typeof professionalInput>;

/**
 * Cria (ou vincula) um profissional ao salão atual.
 * A Membership só é criada quando o convite é aceito. Para uma conta já
 * existente, o próprio usuário precisa autenticar antes de aceitar.
 */
export async function createProfessional(
  input: ProfessionalInput,
): Promise<{
  recipientEmail: string;
  deliveryStatus: "SENT" | "FAILED";
  expiresAt: string;
}> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = professionalInput.parse(input);
  const email = data.email.toLowerCase().trim();
  const requestHeaders = await headers();
  const limited = await checkRateLimit({
    namespace: "create-professional-invite",
    identifier: `${ctx.salonId}:${ctx.userId}:${clientIp(requestHeaders)}`,
    limit: 10,
    windowSeconds: 60 * 60,
  });
  if (!limited.allowed) {
    throw new Error("Muitos convites criados. Aguarde e tente novamente.");
  }

  const invite = await createUserInvite({
    salonId: ctx.salonId,
    createdById: ctx.userId,
    email,
    name: data.name,
    role: "PROFESSIONAL",
    professional: {
      bio: data.bio ?? null,
      colorHex: data.colorHex ?? null,
      commissionPct: data.commissionPct,
      monthlyGoalCents: data.monthlyGoalCents,
      serviceIds: data.serviceIds,
    },
  });

  revalidatePath("/profissionais");
  return {
    recipientEmail: invite.recipientEmail,
    deliveryStatus: invite.deliveryStatus,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

const inviteIdInput = z.string().cuid();

async function limitInviteAction(namespace: string, salonId: string, userId: string) {
  const requestHeaders = await headers();
  const limited = await checkRateLimit({
    namespace,
    identifier: `${salonId}:${userId}:${clientIp(requestHeaders)}`,
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!limited.allowed) throw new Error("Muitas tentativas. Aguarde e tente novamente.");
}

export async function resendProfessionalInvite(inviteId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await limitInviteAction("resend-professional-invite", ctx.salonId, ctx.userId);
  const result = await resendUserInvite(inviteIdInput.parse(inviteId), {
    userId: ctx.userId,
    salonId: ctx.salonId,
  });
  revalidatePath("/profissionais");
  return {
    deliveryStatus: result.deliveryStatus,
    expiresAt: result.expiresAt.toISOString(),
  };
}

export async function cancelProfessionalInvite(inviteId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await limitInviteAction("cancel-professional-invite", ctx.salonId, ctx.userId);
  await revokeUserInvite(inviteIdInput.parse(inviteId), {
    userId: ctx.userId,
    salonId: ctx.salonId,
  });
  revalidatePath("/profissionais");
}

const updateInput = z.object({
  name: z.string().min(2),
  bio: z.string().optional().nullable(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  commissionPct: z.coerce.number().min(0).max(100),
  monthlyGoalCents: z.coerce.number().int().min(0).default(0),
});

export async function updateProfessional(
  id: string,
  input: z.infer<typeof updateInput>,
) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = updateInput.parse(input);

  const pro = await prisma.professional.findFirst({
    where: { id, salonId: ctx.salonId },
    select: { userId: true },
  });
  if (!pro) throw new Error("Not found");

  await prisma.$transaction([
    prisma.professional.update({
      where: { id },
      data: {
        bio: data.bio ?? null,
        colorHex: data.colorHex ?? null,
        commissionPct: data.commissionPct,
        monthlyGoalCents: data.monthlyGoalCents,
      },
    }),
    prisma.user.update({
      where: { id: pro.userId },
      data: { name: data.name },
    }),
  ]);
  revalidatePath("/profissionais");
}

export async function toggleProfessionalActive(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const p = await prisma.professional.findFirst({
    where: { id, salonId: ctx.salonId },
    select: { active: true },
  });
  if (!p) throw new Error("Not found");
  await prisma.professional.update({ where: { id }, data: { active: !p.active } });
  revalidatePath("/profissionais");
}

const workingDayInput = z.object({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean(),
  startMinutes: z.number().int().min(0).max(24 * 60),
  endMinutes: z.number().int().min(0).max(24 * 60),
});

export async function setWorkingHours(
  professionalId: string,
  days: z.infer<typeof workingDayInput>[],
) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);

  const pro = await prisma.professional.findFirst({
    where: { id: professionalId, salonId: ctx.salonId },
    select: { id: true },
  });
  if (!pro) throw new Error("Not found");

  const parsed = days.map((d) => workingDayInput.parse(d));
  for (const d of parsed) {
    if (d.enabled && d.endMinutes <= d.startMinutes) {
      throw new Error(`Horário inválido no dia ${d.weekday}: fim ≤ início`);
    }
  }

  await prisma.$transaction([
    prisma.workingHours.deleteMany({ where: { professionalId } }),
    prisma.workingHours.createMany({
      data: parsed
        .filter((d) => d.enabled)
        .map((d) => ({
          salonId: ctx.salonId,
          professionalId,
          weekday: d.weekday,
          startMinutes: d.startMinutes,
          endMinutes: d.endMinutes,
        })),
    }),
  ]);
  revalidatePath("/profissionais");
  revalidatePath("/agenda");
}

export async function setProfessionalServices(
  professionalId: string,
  serviceIds: string[],
) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);

  // Confirma que o pro pertence a este salão
  const pro = await prisma.professional.findFirst({
    where: { id: professionalId, salonId: ctx.salonId },
    select: { id: true },
  });
  if (!pro) throw new Error("Not found");

  // Confirma que todos os serviços pertencem a este salão
  const validServices = await prisma.service.findMany({
    where: { id: { in: serviceIds }, salonId: ctx.salonId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.professionalService.deleteMany({ where: { professionalId } }),
    prisma.professionalService.createMany({
      data: validServices.map((s) => ({ professionalId, serviceId: s.id })),
    }),
  ]);
  revalidatePath("/profissionais");
}
