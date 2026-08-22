import { describe, expect, it } from "vitest";
import { summarizeDailyClosing } from "../daily-closing";

describe("summarizeDailyClosing", () => {
  it("separa recebido, despesas e pagamentos pendentes", () => {
    const summary = summarizeDailyClosing({
      appointments: [
        { status: "COMPLETED", priceCents: 8000, payment: { amountCents: 8000, method: "PIX" } },
        { status: "COMPLETED", priceCents: 6000, payment: null },
        { status: "NO_SHOW", priceCents: 5000, payment: null },
        { status: "CANCELLED", priceCents: 4000, payment: null },
      ],
      payments: [
        { amountCents: 8000, method: "PIX" },
        { amountCents: 3000, method: "CASH" },
      ],
      expenses: [{ amountCents: 1200 }, { amountCents: 800 }],
    });

    expect(summary).toMatchObject({
      appointmentCount: 4,
      completedCount: 2,
      noShowCount: 1,
      cancelledCount: 1,
      pendingPaymentCount: 1,
      pendingPaymentCents: 6000,
      receivedCents: 11000,
      cashReceivedCents: 3000,
      expensesCents: 2000,
      netCents: 9000,
    });
    expect(summary.paymentBreakdown).toEqual([
      { method: "PIX", label: "PIX", amountCents: 8000 },
      { method: "CASH", label: "Dinheiro", amountCents: 3000 },
    ]);
  });

  it("funciona com um dia sem movimentos", () => {
    expect(summarizeDailyClosing({ appointments: [], payments: [], expenses: [] })).toEqual({
      appointmentCount: 0,
      completedCount: 0,
      noShowCount: 0,
      cancelledCount: 0,
      pendingPaymentCount: 0,
      pendingPaymentCents: 0,
      receivedCents: 0,
      cashReceivedCents: 0,
      expensesCents: 0,
      netCents: 0,
      paymentBreakdown: [],
    });
  });
});
