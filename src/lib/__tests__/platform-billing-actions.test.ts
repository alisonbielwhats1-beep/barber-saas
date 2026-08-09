import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getPlatformAdminContext: vi.fn(async () => ({
    userId: "platform-admin",
    email: "admin@example.com",
    name: "Admin",
  })),
  salonFindUnique: vi.fn(),
  invoiceCreate: vi.fn(async () => ({ id: "invoice-1" })),
  invoiceFindUnique: vi.fn(),
  invoiceUpdateMany: vi.fn(async () => ({ count: 1 })),
  eventCreate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/platform-admin", () => ({
  getPlatformAdminContext: mocks.getPlatformAdminContext,
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withUser: async (_userId: string, callback: (tx: unknown) => unknown) =>
    callback({
      salon: { findUnique: mocks.salonFindUnique },
      platformInvoice: {
        create: mocks.invoiceCreate,
        findUnique: mocks.invoiceFindUnique,
        updateMany: mocks.invoiceUpdateMany,
      },
      platformInvoiceEvent: { create: mocks.eventCreate },
    }),
}));

import {
  createPlatformInvoice,
  markPlatformInvoicePaid,
  voidPlatformInvoice,
} from "@/app/(platform)/plataforma/cobrancas/actions";

describe("cobranças manuais da plataforma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_BILLING_ENABLED = "true";
    mocks.invoiceUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("cria cobrança somente para estabelecimento Pro ativo e registra histórico", async () => {
    mocks.salonFindUnique.mockResolvedValue({ id: "salon-1", plan: "PRO", accessStatus: "APPROVED" });

    await createPlatformInvoice({
      salonId: "salon-1",
      reference: "Agosto/2026",
      amount: "99,90",
      dueDate: "2026-08-15",
      notes: "Mensalidade",
    });

    expect(mocks.invoiceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        salonId: "salon-1",
        amountCents: 9990,
        reference: "Agosto/2026",
        createdByUserId: "platform-admin",
      }),
      select: { id: true },
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ invoiceId: "invoice-1", type: "CREATED", newStatus: "OPEN" }),
    });
  });

  it("não mistura cobrança do SaaS com estabelecimento gratuito", async () => {
    mocks.salonFindUnique.mockResolvedValue({ id: "salon-1", plan: "FREE", accessStatus: "APPROVED" });

    await expect(
      createPlatformInvoice({
        salonId: "salon-1",
        reference: "Agosto/2026",
        amount: "99,90",
        dueDate: "2026-08-15",
      }),
    ).rejects.toThrow("somente para estabelecimentos Pro ativos");
    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
  });

  it("dá baixa com atualização concorrente e evento imutável", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({ id: "invoice-1", status: "OPEN" });

    await markPlatformInvoicePaid({
      invoiceId: "invoice-1",
      paidDate: "2026-08-09",
      paymentMethod: "PIX",
      notes: "Recebido",
    });

    expect(mocks.invoiceUpdateMany).toHaveBeenCalledWith({
      where: { id: "invoice-1", status: "OPEN" },
      data: expect.objectContaining({ status: "PAID", paymentMethod: "PIX" }),
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "MARKED_PAID", previousStatus: "OPEN", newStatus: "PAID" }),
    });
  });

  it("anula sem apagar e exige motivo", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({ id: "invoice-1", status: "OPEN" });

    await voidPlatformInvoice({ invoiceId: "invoice-1", reason: "Cobrança duplicada" });

    expect(mocks.invoiceUpdateMany).toHaveBeenCalledWith({
      where: { id: "invoice-1", status: "OPEN" },
      data: expect.objectContaining({ status: "VOID", notes: "Cobrança duplicada" }),
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "VOIDED", newStatus: "VOID" }),
    });
  });
});
