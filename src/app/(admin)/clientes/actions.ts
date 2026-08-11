"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getClientHistory } from "@/lib/crm";
import { serializeClientCareProfile } from "@/lib/client-care-profile";

export async function fetchClientHistory(clientId: string) {
  const ctx = await getTenantContext();
  return withTenant(ctx, async (tx) => {
    const professional = ctx.role === "PROFESSIONAL"
      ? await tx.professional.findFirst({
          where: { salonId: ctx.salonId, userId: ctx.userId, active: true },
          select: { id: true },
        })
      : null;
    if (ctx.role === "PROFESSIONAL" && !professional) return [];
    return getClientHistory(tx, ctx.salonId, clientId, professional?.id);
  });
}

const clientInput = z.object({
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  birthday: z.string().optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  allergies: z.string().max(1000).optional().nullable(),
  preferences: z.string().max(1000).optional().nullable(),
  consentGiven: z.boolean().default(false),
});

export type ClientInput = z.infer<typeof clientInput>;

export async function createClient(input: ClientInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = clientInput.parse(input);

  await withTenant(ctx, (tx) =>
    tx.clientProfile.create({
      data: {
        salonId: ctx.salonId,
        name: data.name,
        phone: data.phone ?? null,
        email: data.email || null,
        birthday: data.birthday ? new Date(data.birthday) : null,
        gender: data.gender ?? null,
        notes: serializeClientCareProfile({
          notes: data.notes ?? "",
          allergies: data.allergies ?? "",
          preferences: data.preferences ?? "",
          consentGiven: data.consentGiven,
        }),
      },
    }),
  );
  revalidatePath("/clientes");
}

export async function updateClient(id: string, input: ClientInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = clientInput.parse(input);

  await withTenant(ctx, (tx) =>
    tx.clientProfile.updateMany({
      where: { id, salonId: ctx.salonId },
      data: {
        name: data.name,
        phone: data.phone ?? null,
        email: data.email || null,
        birthday: data.birthday ? new Date(data.birthday) : null,
        gender: data.gender ?? null,
        notes: serializeClientCareProfile({
          notes: data.notes ?? "",
          allergies: data.allergies ?? "",
          preferences: data.preferences ?? "",
          consentGiven: data.consentGiven,
        }),
      },
    }),
  );
  revalidatePath("/clientes");
}

export async function deleteClient(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, (tx) =>
    tx.clientProfile.deleteMany({ where: { id, salonId: ctx.salonId } }),
  );
  revalidatePath("/clientes");
}
