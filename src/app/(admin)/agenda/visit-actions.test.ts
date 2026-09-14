import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  ctx: { salonId: "salon-a", userId: "user-a", role: "PROFESSIONAL" },
  professional: vi.fn(),
  client: vi.fn(),
  create: vi.fn(),
  load: vi.fn(),
  hidden: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({
  getTenantContext: async () => m.ctx,
  assertRole: (_ctx: unknown, roles: string[]) => {
    if (!roles.includes(m.ctx.role)) throw Error("FORBIDDEN");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withTenant: async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      professional: { findFirst: m.professional },
      clientProfile: { findFirst: m.client },
    }),
}));
vi.mock("@/lib/client-list-visibility", () => ({ hiddenClientIds: m.hidden }));
vi.mock("@/lib/visit-scheduling", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createVisit: m.create,
  loadVisitDay: m.load,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { confirmStaffVisit, previewStaffVisit } from "./visit-actions";
const input = () => ({
  choices: [{ serviceId: "hair", professionalId: "own" }],
  startLocal: "2026-10-04T15:00",
  clientId: "client-a",
  quote: "a".repeat(64),
  idempotencyKey: crypto.randomUUID(),
  scheduleOverrideReason: "Atender na folga",
});
beforeEach(() => {
  vi.clearAllMocks();
  m.ctx.role = "PROFESSIONAL";
  m.professional.mockResolvedValue({ id: "own" });
  m.client.mockResolvedValue({ id: "client-a" });
  m.hidden.mockResolvedValue(new Set());
  m.create.mockResolvedValue({ appointmentIds: ["a"], duplicate: false });
});
describe("autonomia na própria agenda", () => {
  it("profissional pode confirmar visita própria na folga com exceção registrada", async () => {
    expect(await confirmStaffVisit(input())).toMatchObject({ success: true });
    expect(m.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        manual: true,
        salonId: "salon-a",
        scheduleOverrideReason: "Atender na folga",
      }),
    );
  });
  it("não permite usar autonomia para gravar na agenda de colega", async () => {
    await expect(
      previewStaffVisit({
        ...input(),
        choices: [{ serviceId: "hair", professionalId: "other" }],
      }),
    ).resolves.toMatchObject({ error: expect.stringContaining("Seu acesso não permite") });
    expect(m.load).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("não permite cliente fora do escopo do profissional", async () => {
    m.client.mockResolvedValue(null);
    await confirmStaffVisit(input());
    expect(m.create).not.toHaveBeenCalled();
  });
  it("recepção não recebe a exceção da jornada do profissional", async () => {
    m.ctx.role = "RECEPTIONIST";
    await confirmStaffVisit(input());
    expect(m.create).not.toHaveBeenCalled();
  });
  it("dono pode criar com profissionais diferentes, sem recuperar cliente excluído", async () => {
    m.ctx.role = "OWNER";
    await confirmStaffVisit({
      ...input(),
      choices: [
        { serviceId: "hair", professionalId: "own" },
        { serviceId: "nails", professionalId: "other" },
      ],
    });
    expect(m.create).toHaveBeenCalledOnce();
    m.create.mockClear();
    m.hidden.mockResolvedValue(new Set(["client-a"]));
    await confirmStaffVisit(input());
    expect(m.create).not.toHaveBeenCalled();
  });
});
