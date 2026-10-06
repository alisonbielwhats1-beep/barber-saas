"use server";

import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { assertServiceWriter } from "@/lib/service-catalog";
import { getOperationRequirements, parseServiceMvpMessage } from "@/lib/service-contract";
import { upsertActionDraft, proposeServiceCreate, confirmServiceCreate } from "@/lib/service-create-mvp";
import { z } from "zod";
import { assertSafeDatabaseOperation } from "@/lib/database-safety";

async function context() {
  if (process.env.SERVICE_CREATE_MVP_ENABLED !== "true" ||
      !["development", "test"].includes(process.env.APP_ENV ?? "") ||
      process.env.VERCEL_ENV === "production") throw new Error("MVP_DISABLED");
  assertSafeDatabaseOperation(process.env, { operation: "service-create-mvp" });
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  return ctx;
}

export async function getServiceCreateRequirements() {
  const ctx = await context();
  return withTenant(ctx, async (tx) => {
    await assertServiceWriter(tx, ctx);
    return getOperationRequirements();
  });
}

export async function saveServiceCreateDraft(input: unknown) {
  const ctx = await context();
  return withTenant(ctx, (tx) => upsertActionDraft(tx, ctx, input));
}

export async function submitServiceCreateMessage(input: unknown) {
  const ctx = await context();
  const parsed = z.object({
    message: z.string().max(200), draft_ref: z.string().uuid().optional(),
    expected_revision: z.number().int().positive().optional(),
  }).strict().parse(input);
  return withTenant(ctx, (tx) => upsertActionDraft(tx, ctx, {
    draft_ref: parsed.draft_ref, expected_revision: parsed.expected_revision,
    patch: parseServiceMvpMessage(parsed.message),
  }));
}

export async function prepareServiceCreateProposal(input: unknown) {
  const ctx = await context();
  return withTenant(ctx, (tx) => proposeServiceCreate(tx, ctx, input));
}

export async function confirmServiceCreateProposal(input: unknown) {
  const ctx = await context();
  const result = await withTenant(ctx, (tx) => confirmServiceCreate(tx, ctx, input));
  revalidatePath("/servicos");
  const salon = await withTenant(ctx, (tx) => tx.salon.findUnique({
    where: { id: ctx.salonId }, select: { slug: true },
  }));
  if (salon) revalidatePath(`/book/${salon.slug}`, "layout");
  return result;
}
