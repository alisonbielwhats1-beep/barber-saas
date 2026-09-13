"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant, type Tx } from "@/lib/prisma-tenant";
import { writeAuditLog } from "@/lib/audit";
import {
  HOURS_ACTION,
  REVIEW_ACTION,
  SETUP_ACTION,
  SETUP_PATH,
  setupChecks,
  setupHoursSchema,
  setupServiceSchema,
  type SetupServiceInput,
} from "@/lib/initial-setup";
import { getInitialSetup } from "@/lib/initial-setup-server";
import { effectiveEntitlement } from "@/lib/billing/entitlements";
import { assertProfessionalCapacity } from "@/lib/plan-entitlements";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { isValidPhoneBR, normalizePhone } from "@/lib/phone";

async function context() {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  return ctx;
}

async function lockSetup(tx: Tx, salonId: string) {
  await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtextextended(${`initial-setup:${salonId}`}, 0))`;
}

function refresh() {
  for (const path of [
    SETUP_PATH,
    "/dashboard",
    "/servicos",
    "/profissionais",
    "/configuracoes",
    "/agenda",
    "/hoje",
  ])
    revalidatePath(path);
  revalidatePath("/book", "layout");
}

export async function saveSetupProgress(input: {
  step: number;
  status: "active" | "deferred" | "completed";
}) {
  const ctx = await context();
  const data = z
    .object({
      step: z.number().int().min(0).max(3),
      status: z.enum(["active", "deferred", "completed"]),
    })
    .parse(input);
  await withTenant(ctx, async (tx) => {
    await lockSetup(tx, ctx.salonId);
    if (
      data.status === "completed" &&
      !setupChecks(await getInitialSetup(tx, ctx))
        .slice(0, 3)
        .every(Boolean)
    )
      throw new Error(
        "Revise horários, serviços e profissionais antes de concluir. Você pode fazer isso depois.",
      );
    await writeAuditLog(tx, {
      ...ctx,
      actorName: "Equipe",
      action: SETUP_ACTION,
      entityType: "Salon",
      entityId: ctx.salonId,
      metadata: data,
    });
  });
  refresh();
}

export async function saveSetupHours(input: unknown) {
  const ctx = await context();
  const parsed = setupHoursSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  await withTenant(ctx, async (tx) => {
    await lockSetup(tx, ctx.salonId);
    const hours = parsed.data;
    const before = await tx.salon.findUniqueOrThrow({
      where: { id: ctx.salonId },
      select: { openMinutes: true, closeMinutes: true },
    });
    await tx.salon.update({
      where: { id: ctx.salonId },
      data: {
        openMinutes: Math.min(...hours.map((h) => h.startMinutes)),
        closeMinutes: Math.max(...hours.map((h) => h.endMinutes)),
      },
    });
    await writeAuditLog(tx, {
      ...ctx,
      actorName: "Equipe",
      action: HOURS_ACTION,
      entityType: "Salon",
      entityId: ctx.salonId,
      metadata: { hours, before },
      reason: "Referência inicial salva; jornadas existentes preservadas.",
    });
    await writeAuditLog(tx, {
      ...ctx,
      actorName: "Equipe",
      action: SETUP_ACTION,
      entityType: "Salon",
      entityId: ctx.salonId,
      metadata: { status: "active", step: 1 },
    });
  });
  refresh();
}

export async function saveSetupService(input: SetupServiceInput) {
  const ctx = await context();
  const parsed = setupServiceSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const { id, name, durationMin, priceCents } = parsed.data;
  await withTenant(ctx, async (tx) => {
    await lockSetup(tx, ctx.salonId);
    const current = id
      ? await tx.service.findFirst({
          where: { id, salonId: ctx.salonId, active: true },
        })
      : null;
    if (id && !current)
      throw new Error("Serviço não encontrado neste estabelecimento.");
    if (current && current.processingMin + current.finishingMin >= durationMin)
      throw new Error(
        "A duração deve comportar as etapas do serviço. Revise em Serviços.",
      );
    const service = current
      ? await tx.service.update({
          where: { id: current.id, salonId: ctx.salonId },
          data: { name, durationMin, priceCents },
        })
      : await tx.service.create({
          data: { salonId: ctx.salonId, name, durationMin, priceCents },
        });
    await writeAuditLog(tx, {
      ...ctx,
      actorName: "Equipe",
      action: REVIEW_ACTION,
      entityType: "Service",
      entityId: service.id,
      metadata: { name, durationMin, priceCents },
    });
  });
  refresh();
}

/** Adds the authenticated owner only: no fabricated user, password or invitation. */
export async function enableMySetupAgenda() {
  const ctx = await context();
  assertRole(ctx, ["OWNER"]);
  try {
    await withTenant(ctx, async (tx) => {
      await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtextextended(${`professional-capacity:${ctx.salonId}`}, 0))`;
      const existing = await tx.professional.findFirst({
        where: { userId: ctx.userId, salonId: ctx.salonId },
      });
      if (existing?.active) return;
      const salon = await tx.salon.findUniqueOrThrow({
        where: { id: ctx.salonId },
        select: { plan: true },
      });
      const activeProfessionals = await tx.professional.count({
        where: { salonId: ctx.salonId, active: true },
      });
      const pendingProfessionalInvites = await tx.userInvite.count({
        where: {
          salonId: ctx.salonId,
          role: "PROFESSIONAL",
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      assertProfessionalCapacity({
        plan: await effectiveEntitlement(tx, ctx.salonId, salon.plan),
        activeProfessionals,
        pendingProfessionalInvites,
      });
      const pro = existing
        ? await tx.professional.update({
            where: { id: existing.id, salonId: ctx.salonId },
            data: { active: true },
          })
        : await tx.professional.create({
            data: { salonId: ctx.salonId, userId: ctx.userId },
          });
      await writeAuditLog(tx, {
        ...ctx,
        actorName: "Proprietário",
        action: "INITIAL_SETUP_SELF_AGENDA",
        entityType: "Professional",
        entityId: pro.id,
      });
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      throw new Error(
        "Sua conta já possui uma agenda profissional. Gerencie a equipe em Profissionais.",
      );
    throw error;
  }
  refresh();
}

export async function saveSetupProfessional(input: {
  id: string;
  serviceIds: string[];
  applyHours: boolean;
}) {
  const ctx = await context();
  const data = z
    .object({
      id: z.string().min(1),
      serviceIds: z.array(z.string().min(1)).min(1).max(100),
      applyHours: z.boolean(),
    })
    .parse(input);
  await withTenant(ctx, async (tx) => {
    await lockSetup(tx, ctx.salonId);
    const pro = await tx.professional.findFirst({
      where: { id: data.id, salonId: ctx.salonId, active: true },
      select: { id: true },
    });
    if (!pro)
      throw new Error("Profissional não encontrado neste estabelecimento.");
    await lockOperationalResources(tx, { professionalIds: [pro.id] });
    const ids = [...new Set(data.serviceIds)];
    const services = await tx.service.count({
      where: { salonId: ctx.salonId, id: { in: ids }, active: true },
    });
    if (services !== ids.length)
      throw new Error("Selecione serviços ativos deste estabelecimento.");
    if (data.applyHours) {
      const count = await tx.workingHours.count({
        where: { salonId: ctx.salonId, professionalId: pro.id },
      });
      if (count > 0)
        throw new Error(
          "Este profissional já tem uma jornada. Revise os horários em Profissionais.",
        );
      const setup = await getInitialSetup(tx, ctx);
      if (!setup.hoursConfirmed || !setup.hours.length)
        throw new Error("Salve os horários na primeira etapa.");
      await tx.workingHours.createMany({
        data: setup.hours.map((h) => ({
          ...h,
          salonId: ctx.salonId,
          professionalId: pro.id,
        })),
      });
    }
    // Additive: the guide never removes an existing service assignment.
    await tx.professionalService.createMany({
      data: ids.map((serviceId) => ({ professionalId: pro.id, serviceId })),
      skipDuplicates: true,
    });
    await writeAuditLog(tx, {
      ...ctx,
      actorName: "Equipe",
      action: "INITIAL_SETUP_PROFESSIONAL",
      entityType: "Professional",
      entityId: pro.id,
      metadata: data,
    });
  });
  refresh();
}

export async function saveSetupContact(input: {
  address: string;
  phone: string;
}) {
  const ctx = await context();
  const data = z
    .object({
      address: z.string().trim().max(300),
      phone: z
        .string()
        .trim()
        .max(25)
        .refine(
          (s) => !s || isValidPhoneBR(s),
          "Informe um telefone válido com DDD.",
        )
        .transform(normalizePhone),
    })
    .parse(input);
  await withTenant(ctx, (tx) =>
    tx.salon.update({
      where: { id: ctx.salonId },
      data: { address: data.address || null, phone: data.phone || null },
    }),
  );
  refresh();
}
