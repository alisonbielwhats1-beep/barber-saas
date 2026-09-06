import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
vi.mock("../dashboard", () => ({ resolveRange: () => ({ from: new Date("2026-09-01T03:00:00Z"), to: new Date("2026-09-03T03:00:00Z"), fromDate: "2026-09-01", toDate: "2026-09-03" }) }));
vi.mock("../kpis", () => ({ getProfessionalPerformance: vi.fn().mockResolvedValue([]) }));
import { getFinanceMetrics } from "../finance";

describe("finance: separate realization, cash and forecast", () => {
  it("only counts paid transactions in cashflow and includes completed unpaid work in receivables", async () => {
    const paymentQuery = vi.fn().mockResolvedValue([{ amountCents: 7000, method: "PIX", paidAt: new Date("2026-09-02T10:00:00Z") }]);
    const expenseQuery = vi.fn()
      .mockResolvedValueOnce([{ amountCents: 5000, kind: "FIXED", category: "Aluguel", dueDate: new Date("2026-09-01T10:00:00Z"), paidAt: null }])
      .mockResolvedValueOnce([{ amountCents: 2000, paidAt: new Date("2026-09-02T10:00:00Z") }])
      .mockResolvedValueOnce([{ amountCents: 5000 }]);
    const appointmentQuery = vi.fn().mockResolvedValueOnce([{ priceCents: 10000, startAt: new Date("2026-09-01T10:00:00Z") }])
      .mockResolvedValueOnce([{ priceCents: 10000, products: [{ quantity: 2, priceCentsUnit: 1500 }] }])
      .mockResolvedValueOnce([{ priceCents: 8000 }]);
    const tx = { appointment: { findMany: appointmentQuery }, appointmentProduct: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: paymentQuery }, expense: { findMany: expenseQuery } } as unknown as Tx;
    const metrics = await getFinanceMetrics(tx, "salon-a", "30d");
    expect(metrics.cashflow).toEqual([{ date: "2026-09-01", inflow: 0, outflow: 0, net: 0 }, { date: "2026-09-02", inflow: 7000, outflow: 2000, net: 5000 }]);
    expect(metrics.receivable).toBe(13000);
    expect(metrics.forecast).toBe(8000);
    expect(metrics.expenseTotal).toBe(5000);
    expect(paymentQuery.mock.calls[0][0].where).toEqual({ appointment: { salonId: "salon-a" }, paidAt: expect.any(Object) });
    expect(appointmentQuery.mock.calls[1][0].where).toMatchObject({ salonId: "salon-a", status: "COMPLETED", payment: { is: null } });
  });
});
