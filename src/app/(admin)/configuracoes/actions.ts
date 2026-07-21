"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";

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

export async function inviteMember(input: { email: string; name: string; role: string }) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  const email = z.string().email().parse(input.email);
  const name = z.string().min(2).parse(input.name);
  const role = z.enum(ROLES).parse(input.role);

  let user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    // Cria conta placeholder; a pessoa define a senha no primeiro acesso
    const bcrypt = (await import("bcryptjs")).default;
    const passwordHash = await bcrypt.hash("trocar-agora", 10);
    user = await prisma.user.create({ data: { email, name, passwordHash }, select: { id: true } });
  }

  await prisma.membership.upsert({
    where: { userId_salonId: { userId: user.id, salonId: ctx.salonId } },
    update: { role },
    create: { userId: user.id, salonId: ctx.salonId, role },
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
