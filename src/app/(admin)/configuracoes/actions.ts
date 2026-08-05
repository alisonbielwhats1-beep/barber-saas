"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
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
  minBookingLeadMinutes: z.coerce.number().int().min(0).max(10_080), // até 7 dias
  maxBookingLeadDays: z.coerce.number().int().min(1).max(365),
  bufferMinutes: z.coerce.number().int().min(0).max(120),
});

export async function updateSalonSettings(input: z.infer<typeof salonInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = salonInput.parse(input);
  if (data.closeMinutes <= data.openMinutes) throw new Error("Fechamento deve ser depois da abertura");

  await withTenant(ctx, (tx) =>
    tx.salon.update({
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
        minBookingLeadMinutes: data.minBookingLeadMinutes,
        maxBookingLeadDays: data.maxBookingLeadDays,
        bufferMinutes: data.bufferMinutes,
      },
    }),
  );
  revalidatePath("/configuracoes");
  revalidatePath("/dashboard");
}

// ─── Personalização da vitrine ──────────────────────────────────────────────

/** Só os métodos que o schema já conhece — evita string livre virando lixo. */
const PAYMENT_METHODS = ["CASH", "CREDIT_CARD", "DEBIT_CARD", "PIX", "TRANSFER"] as const;

const brandingInput = z.object({
  segment: z.string().max(40).optional().nullable(),
  description: z.string().max(600).optional().nullable(),
  coverUrl: z.string().url("URL de capa inválida").optional().nullable().or(z.literal("")),
  themeColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor deve estar no formato #RRGGBB")
    .optional()
    .nullable()
    .or(z.literal("")),
  instagram: z.string().max(60).optional().nullable(),
  whatsapp: z.string().max(20).optional().nullable(),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).optional(),
  importantInfo: z.string().max(600).optional().nullable(),
});

export type BrandingInput = z.infer<typeof brandingInput>;

/** Vazio vira null para não gravar string em branco e ter que tratar depois. */
function orNull(v: string | null | undefined) {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Identidade da vitrine: o que o cliente final vê em /book/[slug].
 * Separada de `updateSalonSettings` de propósito — aquela mexe em regra de
 * operação (horário, política de cancelamento, moeda) e esta em aparência.
 * Misturar as duas faria um formulário de aparência exigir as validações da
 * operação.
 */
export async function updateSalonBranding(input: BrandingInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = brandingInput.parse(input);

  const salon = await withTenant(ctx, async (tx) => {
    await tx.salon.update({
      where: { id: ctx.salonId },
      data: {
        segment: orNull(data.segment),
        description: orNull(data.description),
        coverUrl: orNull(data.coverUrl),
        themeColorHex: orNull(data.themeColorHex),
        // Guardamos só dígitos: o link wa.me não aceita máscara.
        whatsapp: orNull(data.whatsapp?.replace(/\D/g, "")),
        // Sem "@" no banco; a vitrine adiciona ao exibir.
        instagram: orNull(data.instagram?.replace(/^@/, "")),
        paymentMethods: data.paymentMethods?.length ? data.paymentMethods.join(",") : null,
        importantInfo: orNull(data.importantInfo),
      },
    });
    // A vitrine é pública e cacheada por slug — sem isto o cliente continuaria
    // vendo a versão antiga.
    return tx.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } });
  });

  revalidatePath("/configuracoes");
  if (salon) revalidatePath(`/book/${salon.slug}`);
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

  await withTenant(ctx, async (tx) => {
    // Não permite rebaixar o último OWNER
    if (parsed !== "OWNER") {
      const owners = await tx.membership.count({ where: { salonId: ctx.salonId, role: "OWNER" } });
      const target = await tx.membership.findUnique({
        where: { userId_salonId: { userId, salonId: ctx.salonId } },
        select: { role: true },
      });
      if (target?.role === "OWNER" && owners <= 1) throw new Error("O salão precisa de ao menos um dono");
    }

    await tx.membership.update({
      where: { userId_salonId: { userId, salonId: ctx.salonId } },
      data: { role: parsed },
    });
  });
  revalidatePath("/configuracoes");
}

export async function removeMember(userId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  if (userId === ctx.userId) throw new Error("Você não pode remover a si mesmo");

  await withTenant(ctx, async (tx) => {
    const target = await tx.membership.findUnique({
      where: { userId_salonId: { userId, salonId: ctx.salonId } },
      select: { role: true },
    });
    if (target?.role === "OWNER") {
      const owners = await tx.membership.count({ where: { salonId: ctx.salonId, role: "OWNER" } });
      if (owners <= 1) throw new Error("O salão precisa de ao menos um dono");
    }

    await tx.membership.deleteMany({ where: { userId, salonId: ctx.salonId } });
  });
  revalidatePath("/configuracoes");
}
