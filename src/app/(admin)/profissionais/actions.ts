"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";

const professionalInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  bio: z.string().optional().nullable(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  commissionPct: z.coerce.number().min(0).max(100).default(0),
  password: z.string().min(6).optional(),
});

export type ProfessionalInput = z.infer<typeof professionalInput>;

/**
 * Cria (ou vincula) um profissional ao salão atual.
 * Se o email já existe, apenas cria a Membership + Professional para este salão
 * (útil para profissional que trabalha em mais de um salão da rede).
 */
export async function createProfessional(input: ProfessionalInput) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = professionalInput.parse(input);

  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const passwordHash = await bcrypt.hash(data.password ?? "trocar-agora", 10);
    const user = await prisma.user.create({
      data: { email: data.email, name: data.name, passwordHash },
      select: { id: true },
    });
    userId = user.id;
  }

  await prisma.membership.upsert({
    where: { userId_salonId: { userId, salonId: ctx.salonId } },
    update: { role: "PROFESSIONAL" },
    create: { userId, salonId: ctx.salonId, role: "PROFESSIONAL" },
  });

  await prisma.professional.create({
    data: {
      salonId: ctx.salonId,
      userId,
      bio: data.bio ?? null,
      colorHex: data.colorHex ?? null,
      commissionPct: data.commissionPct,
    },
  });

  revalidatePath("/profissionais");
}

const updateInput = z.object({
  name: z.string().min(2),
  bio: z.string().optional().nullable(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  commissionPct: z.coerce.number().min(0).max(100),
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
