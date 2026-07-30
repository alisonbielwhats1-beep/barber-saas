"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { assertEmailInvitesEnabled } from "@/lib/email-invites-feature";
import {
  createUserInvite,
  resendUserInvite,
  revokeUserInvite,
} from "@/lib/invitations";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const salonInput = z.object({
  name: z.string().min(2, "Nome muito curto"),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  timezone: z.string().min(1),
  currency: z.string().min(1),
  openMinutes: z.coerce.number().int().min(0).max(1440),
  closeMinutes: z.coerce.number().int().min(0).max(1440),
  cancelPolicyHours: z.coerce.number().int().min(0).max(168),
  noShowFeeCents: z.coerce.number().int().min(0),
});

export async function updateSalonSettings(input: z.infer<typeof salonInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = salonInput.parse(input);
  if (data.closeMinutes <= data.openMinutes) throw new Error("Fechamento deve ser depois da abertura");

  await prisma.salon.update({
    where: { id: ctx.salonId },
    data: {
      name: data.name,
      address: data.address ?? null,
      phone: data.phone ?? null,
      timezone: data.timezone,
      currency: data.currency,
      openMinutes: data.openMinutes,
      closeMinutes: data.closeMinutes,
      cancelPolicyHours: data.cancelPolicyHours,
      noShowFeeCents: data.noShowFeeCents,
    },
  });
  revalidatePath("/configuracoes");
  revalidatePath("/dashboard");
}

const ROLES = ["OWNER", "MANAGER", "PROFESSIONAL", "RECEPTIONIST"] as const;

export async function inviteMember(input: {
  email: string;
  name: string;
  role: string;
}): Promise<{
  recipientEmail: string;
  deliveryStatus: "SENT" | "FAILED";
  expiresAt: string;
}> {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  assertEmailInvitesEnabled();
  const email = z.string().email().parse(input.email).toLowerCase().trim();
  const name = z.string().min(2).parse(input.name);
  const role = z.enum(ROLES).parse(input.role);
  const requestHeaders = await headers();
  const limited = await checkRateLimit({
    namespace: "create-team-invite",
    identifier: `${ctx.salonId}:${ctx.userId}:${clientIp(requestHeaders)}`,
    limit: 10,
    windowSeconds: 60 * 60,
    failClosed: true,
  });
  if (!limited.allowed) {
    throw new Error(
      limited.source === "unavailable"
        ? "Serviço de segurança temporariamente indisponível."
        : "Muitos convites criados. Aguarde e tente novamente.",
    );
  }

  const invite = await createUserInvite({
    salonId: ctx.salonId,
    createdById: ctx.userId,
    email,
    name,
    role,
    professional: role === "PROFESSIONAL" ? {} : undefined,
  });

  return {
    recipientEmail: invite.recipientEmail,
    deliveryStatus: invite.deliveryStatus,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

const inviteId = z.string().cuid();

async function limitInviteAction(namespace: string, salonId: string, userId: string) {
  const requestHeaders = await headers();
  const limited = await checkRateLimit({
    namespace,
    identifier: `${salonId}:${userId}:${clientIp(requestHeaders)}`,
    limit: 20,
    windowSeconds: 60 * 60,
    failClosed: true,
  });
  if (!limited.allowed) {
    throw new Error(
      limited.source === "unavailable"
        ? "Serviço de segurança temporariamente indisponível."
        : "Muitas tentativas. Aguarde e tente novamente.",
    );
  }
}

export async function resendTeamInvite(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  assertEmailInvitesEnabled();
  await limitInviteAction("resend-team-invite", ctx.salonId, ctx.userId);
  const result = await resendUserInvite(inviteId.parse(id), {
    salonId: ctx.salonId,
    userId: ctx.userId,
  });
  revalidatePath("/configuracoes");
  return {
    deliveryStatus: result.deliveryStatus,
    expiresAt: result.expiresAt.toISOString(),
  };
}

export async function cancelTeamInvite(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  assertEmailInvitesEnabled();
  await limitInviteAction("cancel-team-invite", ctx.salonId, ctx.userId);
  await revokeUserInvite(inviteId.parse(id), {
    salonId: ctx.salonId,
    userId: ctx.userId,
  });
  revalidatePath("/configuracoes");
}

export async function changeMemberRole(userId: string, role: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  const parsed = z.enum(ROLES).parse(role);

  // Não permite rebaixar o último OWNER
  if (parsed !== "OWNER") {
    const owners = await prisma.membership.count({ where: { salonId: ctx.salonId, role: "OWNER" } });
    const target = await prisma.membership.findUnique({
      where: { userId_salonId: { userId, salonId: ctx.salonId } },
      select: { role: true },
    });
    if (target?.role === "OWNER" && owners <= 1) throw new Error("O salão precisa de ao menos um dono");
  }

  await prisma.membership.update({
    where: { userId_salonId: { userId, salonId: ctx.salonId } },
    data: { role: parsed },
  });
  revalidatePath("/configuracoes");
}

export async function removeMember(userId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  if (userId === ctx.userId) throw new Error("Você não pode remover a si mesmo");

  const target = await prisma.membership.findUnique({
    where: { userId_salonId: { userId, salonId: ctx.salonId } },
    select: { role: true },
  });
  if (target?.role === "OWNER") {
    const owners = await prisma.membership.count({ where: { salonId: ctx.salonId, role: "OWNER" } });
    if (owners <= 1) throw new Error("O salão precisa de ao menos um dono");
  }

  await prisma.membership.deleteMany({ where: { userId, salonId: ctx.salonId } });
  revalidatePath("/configuracoes");
}
