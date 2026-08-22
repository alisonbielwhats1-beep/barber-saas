"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { assertPlatformBillingEnabled } from "@/lib/platform-billing";
import { withUser } from "@/lib/prisma-tenant";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida");
const paymentMethod = z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "PIX", "TRANSFER"]);

const createInput = z.object({
  salonId: z.string().min(1),
  reference: z.string().trim().min(2, "Informe a referência").max(80),
  amount: z.string().trim().min(1),
  dueDate: dateOnly,
  notes: z.string().trim().max(500).optional(),
});

const markPaidInput = z.object({
  invoiceId: z.string().min(1),
  paidDate: dateOnly,
  paymentMethod,
  notes: z.string().trim().max(500).optional(),
});

const voidInput = z.object({
  invoiceId: z.string().min(1),
  reason: z.string().trim().min(3, "Informe o motivo").max(500),
});

function parseDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Data inválida");
  }
  return parsed;
}

function parseAmountToCents(value: string): number {
  const normalized = value.replace(",", ".");
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Informe um valor válido, sem separador de milhar");
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("O valor deve ser maior que zero");
  return cents;
}

export async function createPlatformInvoice(raw: z.infer<typeof createInput>) {
  const admin = await getPlatformAdminContext();
  assertPlatformBillingEnabled();
  const input = createInput.parse(raw);
  const amountCents = parseAmountToCents(input.amount);
  const dueDate = parseDateOnly(input.dueDate);

  try {
    await withUser(admin.userId, async (tx) => {
      const salon = await tx.salon.findUnique({
        where: { id: input.salonId },
        select: { id: true, plan: true, accessStatus: true },
      });
      if (!salon) throw new Error("Estabelecimento não encontrado");
      if (salon.accessStatus !== "APPROVED" || salon.plan === "FREE") {
        throw new Error("A cobrança manual está disponível somente para planos pagos ativos");
      }

      const invoice = await tx.platformInvoice.create({
        data: {
          salonId: salon.id,
          reference: input.reference,
          amountCents,
          dueDate,
          notes: input.notes || null,
          createdByUserId: admin.userId,
          updatedByUserId: admin.userId,
        },
        select: { id: true },
      });
      await tx.platformInvoiceEvent.create({
        data: {
          invoiceId: invoice.id,
          actorUserId: admin.userId,
          type: "CREATED",
          newStatus: "OPEN",
          reason: input.notes || null,
        },
      });
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "P2002") throw new Error("Já existe uma cobrança com essa referência para o estabelecimento");
    throw error;
  }

  revalidatePlatformBilling();
  return { ok: true } as const;
}

export async function markPlatformInvoicePaid(raw: z.infer<typeof markPaidInput>) {
  const admin = await getPlatformAdminContext();
  assertPlatformBillingEnabled();
  const input = markPaidInput.parse(raw);
  const paidDate = parseDateOnly(input.paidDate);

  await withUser(admin.userId, async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, status: true },
    });
    if (!invoice) throw new Error("Cobrança não encontrada");
    if (invoice.status !== "OPEN") throw new Error("Somente cobranças em aberto podem receber baixa");

    const updated = await tx.platformInvoice.updateMany({
      where: { id: invoice.id, status: "OPEN" },
      data: {
        status: "PAID",
        paidDate,
        paymentMethod: input.paymentMethod,
        notes: input.notes || undefined,
        updatedByUserId: admin.userId,
      },
    });
    if (updated.count !== 1) throw new Error("A cobrança foi alterada em outra tela. Atualize a página.");

    await tx.platformInvoiceEvent.create({
      data: {
        invoiceId: invoice.id,
        actorUserId: admin.userId,
        type: "MARKED_PAID",
        previousStatus: "OPEN",
        newStatus: "PAID",
        reason: input.notes || null,
      },
    });
  });

  revalidatePlatformBilling();
  return { ok: true } as const;
}

export async function voidPlatformInvoice(raw: z.infer<typeof voidInput>) {
  const admin = await getPlatformAdminContext();
  assertPlatformBillingEnabled();
  const input = voidInput.parse(raw);

  await withUser(admin.userId, async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, status: true },
    });
    if (!invoice) throw new Error("Cobrança não encontrada");
    if (invoice.status !== "OPEN") throw new Error("Somente cobranças em aberto podem ser anuladas");

    const updated = await tx.platformInvoice.updateMany({
      where: { id: invoice.id, status: "OPEN" },
      data: {
        status: "VOID",
        notes: input.reason,
        updatedByUserId: admin.userId,
      },
    });
    if (updated.count !== 1) throw new Error("A cobrança foi alterada em outra tela. Atualize a página.");

    await tx.platformInvoiceEvent.create({
      data: {
        invoiceId: invoice.id,
        actorUserId: admin.userId,
        type: "VOIDED",
        previousStatus: "OPEN",
        newStatus: "VOID",
        reason: input.reason,
      },
    });
  });

  revalidatePlatformBilling();
  return { ok: true } as const;
}

function revalidatePlatformBilling() {
  revalidatePath("/plataforma");
  revalidatePath("/plataforma/cobrancas");
}
