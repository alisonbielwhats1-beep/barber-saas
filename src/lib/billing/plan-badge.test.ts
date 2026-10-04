import { afterEach, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

vi.mock("server-only", () => ({}));
afterEach(() => { vi.unstubAllEnvs(); });

const terms = (amountCents: number, catalogVersion: string) => ({ plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents, agendaLimit: 1, intervalMonths: 1, catalogVersion });
const sub = { id: "sub", salonId: "salon", current: true, planCode: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, intervalMonths: 1, catalogVersion: "2026-09-13",
  paidThrough: new Date("2099-10-13T17:42:29Z"), delinquentSince: null, cancelledAt: null, cancelRequestedAt: null, reviewRequired: false };
const change = (actorUserId: string) => ({ id: "change", kind: "SCHEDULED", state: "SCHEDULED", actorUserId, fromTerms: terms(5990, "2026-09-13"), toTerms: terms(3990, "2026-10-02") });

function fakeTx(pending: ReturnType<typeof change>) {
  return {
    billingSubscription: { findFirst: vi.fn(async () => sub) },
    billingPlanChange: {
      // Nothing was activated yet; the badge reads the latest confirmed change.
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => "activatedAt" in where ? null : pending),
      findMany: vi.fn(async () => []),
    },
  } as unknown as Tx;
}

it("redução de preço criada pela plataforma não aparece como troca em andamento no atalho do topo", async () => {
  vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_ENABLED", "true");
  const { loadPlanBadge } = await import("./plan-badge");
  expect(await loadPlanBadge(fakeTx(change("system:price-reduction")), "salon", "Grátis")).toEqual({ plan: "Individual · 1 agenda", status: "Ativo", tone: "ok" });
});

it("controle: uma troca pedida pelo dono continua aparecendo como troca em andamento", async () => {
  vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_ENABLED", "true");
  const { loadPlanBadge } = await import("./plan-badge");
  expect(await loadPlanBadge(fakeTx(change("owner-user")), "salon", "Grátis")).toEqual({ plan: "Individual · 1 agenda", status: "Troca em andamento", tone: "neutral" });
});
