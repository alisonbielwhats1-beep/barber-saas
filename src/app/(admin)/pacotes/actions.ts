"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays } from "date-fns";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant, type Tx } from "@/lib/prisma-tenant";
import { assertPlanFeature } from "@/lib/plan-entitlements";

async function assertPackagesEnabled(tx: Tx, salonId: string) {
  const salon = await tx.salon.findUnique({
    where: { id: salonId },
    select: { plan: true },
  });
  assertPlanFeature(salon?.plan, "PACKAGES");
}

/* ───────────────────────── Pacotes (ofertas) ───────────────────────── */

const packageInput = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  sessions: z.coerce.number().int().min(1).max(100),
  priceCents: z.coerce.number().int().min(0),
  validityDays: z.coerce.number().int().min(1).max(730),
});

export async function createPackage(input: z.infer<typeof packageInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const d = packageInput.parse(input);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    await tx.package.create({
      data: {
        salonId: ctx.salonId,
        name: d.name,
        description: d.description ?? null,
        serviceId: d.serviceId || null,
        sessions: d.sessions,
        priceCents: d.priceCents,
        validityDays: d.validityDays,
      },
    });
  });
  revalidatePath("/pacotes");
}

export async function updatePackage(id: string, input: z.infer<typeof packageInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const d = packageInput.parse(input);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    await tx.package.updateMany({
      where: { id, salonId: ctx.salonId },
      data: {
        name: d.name,
        description: d.description ?? null,
        serviceId: d.serviceId || null,
        sessions: d.sessions,
        priceCents: d.priceCents,
        validityDays: d.validityDays,
      },
    });
  });
  revalidatePath("/pacotes");
}

export async function togglePackageActive(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    const pkg = await tx.package.findFirst({ where: { id, salonId: ctx.salonId }, select: { active: true } });
    if (!pkg) throw new Error("Pacote não encontrado");
    await tx.package.updateMany({ where: { id, salonId: ctx.salonId }, data: { active: !pkg.active } });
  });
  revalidatePath("/pacotes");
}

export async function deletePackage(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    await tx.package.deleteMany({ where: { id, salonId: ctx.salonId } });
  });
  revalidatePath("/pacotes");
}

/* ───────────────────────── Vendas de pacote ───────────────────────── */

export async function sellPackage(packageId: string, clientId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    const pkg = await tx.package.findFirst({ where: { id: packageId, salonId: ctx.salonId } });
    const client = await tx.clientProfile.findFirst({
      where: { id: clientId, salonId: ctx.salonId },
      select: { id: true },
    });
    if (!pkg) throw new Error("Pacote inválido");
    if (!client) throw new Error("Cliente inválido");
    await tx.packagePurchase.create({
      data: {
        salonId: ctx.salonId,
        packageId: pkg.id,
        clientId,
        sessionsTotal: pkg.sessions,
        priceCents: pkg.priceCents,
        expiresAt: addDays(new Date(), pkg.validityDays),
      },
    });
  });
  revalidatePath("/pacotes");
  revalidatePath("/dashboard");
}

export async function usePackageSession(purchaseId: string) {
  const ctx = await getTenantContext();
  // O consumo ainda não está ligado atomicamente a um atendimento. Até
  // existir esse vínculo, um profissional não pode consumir saldo de um
  // cliente arbitrário apenas conhecendo o id da compra.
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    const pur = await tx.packagePurchase.findFirst({
      where: { id: purchaseId, salonId: ctx.salonId },
      select: { sessionsUsed: true, sessionsTotal: true, status: true },
    });
    if (!pur) throw new Error("Compra não encontrada");
    if (pur.status !== "ACTIVE") throw new Error("Pacote não está ativo");
    if (pur.sessionsUsed >= pur.sessionsTotal) throw new Error("Sem sessões restantes");
    const used = pur.sessionsUsed + 1;
    await tx.packagePurchase.updateMany({
      where: { id: purchaseId, salonId: ctx.salonId },
      data: { sessionsUsed: used, status: used >= pur.sessionsTotal ? "COMPLETED" : "ACTIVE" },
    });
  });
  revalidatePath("/pacotes");
}

export async function setPurchaseStatus(purchaseId: string, status: "ACTIVE" | "FROZEN" | "CANCELLED") {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    await tx.packagePurchase.updateMany({ where: { id: purchaseId, salonId: ctx.salonId }, data: { status } });
  });
  revalidatePath("/pacotes");
}

export async function renewPurchase(purchaseId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    const pur = await tx.packagePurchase.findFirst({
      where: { id: purchaseId, salonId: ctx.salonId },
      select: { package: { select: { validityDays: true, sessions: true } } },
    });
    if (!pur) throw new Error("Compra não encontrada");
    await tx.packagePurchase.updateMany({
      where: { id: purchaseId, salonId: ctx.salonId },
      data: {
        sessionsUsed: 0,
        sessionsTotal: pur.package.sessions,
        status: "ACTIVE",
        expiresAt: addDays(new Date(), pur.package.validityDays),
      },
    });
  });
  revalidatePath("/pacotes");
}

/* ───────────────────────── Planos (ofertas) ───────────────────────── */

const planInput = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  priceCents: z.coerce.number().int().min(0),
  interval: z.enum(["MONTHLY", "ANNUAL"]),
  discountPct: z.coerce.number().int().min(0).max(100).default(0),
  benefits: z.string().optional().nullable(),
});

export async function createPlan(input: z.infer<typeof planInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const d = planInput.parse(input);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    await tx.membershipPlan.create({
      data: {
        salonId: ctx.salonId,
        name: d.name,
        description: d.description ?? null,
        priceCents: d.priceCents,
        interval: d.interval,
        discountPct: d.discountPct,
        benefits: d.benefits ?? null,
      },
    });
  });
  revalidatePath("/pacotes");
}

export async function updatePlan(id: string, input: z.infer<typeof planInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const d = planInput.parse(input);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    await tx.membershipPlan.updateMany({
      where: { id, salonId: ctx.salonId },
      data: {
        name: d.name,
        description: d.description ?? null,
        priceCents: d.priceCents,
        interval: d.interval,
        discountPct: d.discountPct,
        benefits: d.benefits ?? null,
      },
    });
  });
  revalidatePath("/pacotes");
}

export async function togglePlanActive(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    const plan = await tx.membershipPlan.findFirst({ where: { id, salonId: ctx.salonId }, select: { active: true } });
    if (!plan) throw new Error("Plano não encontrado");
    await tx.membershipPlan.updateMany({ where: { id, salonId: ctx.salonId }, data: { active: !plan.active } });
  });
  revalidatePath("/pacotes");
}

export async function deletePlan(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    await tx.membershipPlan.deleteMany({ where: { id, salonId: ctx.salonId } });
  });
  revalidatePath("/pacotes");
}

/* ───────────────────────── Assinaturas ───────────────────────── */

export async function subscribeClient(planId: string, clientId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    const plan = await tx.membershipPlan.findFirst({ where: { id: planId, salonId: ctx.salonId } });
    const client = await tx.clientProfile.findFirst({
      where: { id: clientId, salonId: ctx.salonId },
      select: { id: true },
    });
    if (!plan) throw new Error("Plano inválido");
    if (!client) throw new Error("Cliente inválido");
    await tx.clientSubscription.create({
      data: {
        salonId: ctx.salonId,
        planId,
        clientId,
        renewsAt: addDays(new Date(), plan.interval === "ANNUAL" ? 365 : 30),
      },
    });
  });
  revalidatePath("/pacotes");
  revalidatePath("/dashboard");
}

export async function cancelSubscription(subscriptionId: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await withTenant(ctx, async (tx) => {
    await assertPackagesEnabled(tx, ctx.salonId);
    await tx.clientSubscription.updateMany({
      where: { id: subscriptionId, salonId: ctx.salonId },
      data: { status: "CANCELLED", autoRenew: false },
    });
  });
  revalidatePath("/pacotes");
}
