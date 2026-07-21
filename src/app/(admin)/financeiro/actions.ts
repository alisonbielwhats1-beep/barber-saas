"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertRole, getTenantContext } from "@/lib/tenant";

const createInput = z.object({
  description: z.string().min(2, "Descreva a despesa"),
  amountCents: z.number().int().positive("Valor inválido"),
  category: z.string().min(1),
  kind: z.enum(["FIXED", "VARIABLE"]),
  method: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "PIX", "TRANSFER"]).nullable().optional(),
  dueDate: z.string(),
  paid: z.boolean(),
});

export async function createExpense(input: z.infer<typeof createInput>) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = createInput.parse(input);

  const dueDate = new Date(data.dueDate);
  await prisma.expense.create({
    data: {
      salonId: ctx.salonId,
      description: data.description,
      amountCents: data.amountCents,
      category: data.category,
      kind: data.kind,
      method: data.paid ? (data.method ?? "PIX") : null,
      dueDate,
      paidAt: data.paid ? new Date() : null,
    },
  });
  revalidatePath("/financeiro");
  revalidatePath("/dashboard");
}

export async function toggleExpensePaid(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const exp = await prisma.expense.findFirst({
    where: { id, salonId: ctx.salonId },
    select: { paidAt: true },
  });
  if (!exp) throw new Error("Despesa não encontrada");
  await prisma.expense.update({
    where: { id },
    data: { paidAt: exp.paidAt ? null : new Date() },
  });
  revalidatePath("/financeiro");
}

export async function deleteExpense(id: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  await prisma.expense.deleteMany({ where: { id, salonId: ctx.salonId } });
  revalidatePath("/financeiro");
}
