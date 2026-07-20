"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";

const clientInput = z.object({
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  birthday: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type ClientInput = z.infer<typeof clientInput>;

export async function createClient(input: ClientInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = clientInput.parse(input);

  await prisma.clientProfile.create({
    data: {
      salonId: ctx.salonId,
      name: data.name,
      phone: data.phone ?? null,
      email: data.email || null,
      birthday: data.birthday ? new Date(data.birthday) : null,
      notes: data.notes ?? null,
    },
  });
  revalidatePath("/clientes");
}

export async function updateClient(id: string, input: ClientInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const data = clientInput.parse(input);

  await prisma.clientProfile.updateMany({
    where: { id, salonId: ctx.salonId },
    data: {
      name: data.name,
      phone: data.phone ?? null,
      email: data.email || null,
      birthday: data.birthday ? new Date(data.birthday) : null,
      notes: data.notes ?? null,
    },
  });
  revalidatePath("/clientes");
}

export async function deleteClient(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await prisma.clientProfile.deleteMany({ where: { id, salonId: ctx.salonId } });
  revalidatePath("/clientes");
}
