import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  ctx: { salonId: "salon-a", userId: "owner", role: "OWNER" },
  audit: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    salon: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    service: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    professional: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userInvite: { count: vi.fn() },
    workingHours: { count: vi.fn(), createMany: vi.fn() },
    professionalService: { createMany: vi.fn() },
  },
  getSetup: vi.fn(),
  withTenant: vi.fn(),
  capacity: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({
  getTenantContext: async () => m.ctx,
  assertRole: (ctx: { role: string }, roles: string[]) => {
    if (!roles.includes(ctx.role)) throw new Error("Forbidden");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: m.withTenant }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: m.audit }));
vi.mock("@/lib/initial-setup-server", () => ({ getInitialSetup: m.getSetup }));
vi.mock("@/lib/plan-entitlements", () => ({
  assertProfessionalCapacity: m.capacity,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  effectiveEntitlement: async () => "FREE",
}));
vi.mock("@/lib/inventory-lock", () => ({ lockOperationalResources: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  enableMySetupAgenda,
  saveSetupHours,
  saveSetupProfessional,
  saveSetupProgress,
  saveSetupService,
  saveSetupContact,
} from "./actions";

describe("ações de configuração", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.ctx.role = "OWNER";
    m.withTenant.mockImplementation(async (_ctx, fn) => fn(m.tx));
    m.tx.salon.findUniqueOrThrow.mockResolvedValue({
      plan: "FREE",
      openMinutes: 540,
      closeMinutes: 1080,
    });
    m.tx.professional.findFirst.mockResolvedValue({
      id: "pro-a",
      active: true,
    });
    m.tx.service.count.mockResolvedValue(1);
    m.tx.workingHours.count.mockResolvedValue(0);
    m.getSetup.mockResolvedValue({
      hoursConfirmed: true,
      hours: [{ weekday: 1, startMinutes: 540, endMinutes: 1080 }],
      services: [],
      professionals: [],
      status: "active",
    });
  });
  it.each(["PROFESSIONAL", "RECEPTIONIST", "CLIENT"])(
    "recusa escrita pelo papel %s antes do banco",
    async (role) => {
      m.ctx.role = role;
      await expect(saveSetupHours([])).rejects.toThrow("Forbidden");
      await expect(
        saveSetupProgress({ step: 0, status: "deferred" }),
      ).rejects.toThrow("Forbidden");
      await expect(
        saveSetupContact({ address: "", phone: "" }),
      ).rejects.toThrow("Forbidden");
      expect(m.withTenant).not.toHaveBeenCalled();
    },
  );
  it("horários gerais não sobrescrevem jornadas e gravam progresso no tenant", async () => {
    await saveSetupHours([{ weekday: 1, startMinutes: 600, endMinutes: 1080 }]);
    expect(m.withTenant).toHaveBeenCalledWith(m.ctx, expect.any(Function));
    expect(m.tx.workingHours.createMany).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(
      m.tx,
      expect.objectContaining({
        salonId: "salon-a",
        action: "INITIAL_SETUP_PROGRESS",
        metadata: { step: 1, status: "active" },
      }),
    );
  });
  it("recusa profissional e serviço estrangeiros", async () => {
    m.tx.professional.findFirst.mockResolvedValueOnce(null);
    await expect(
      saveSetupProfessional({
        id: "foreign",
        serviceIds: ["s1"],
        applyHours: true,
      }),
    ).rejects.toThrow("Profissional não encontrado");
    m.tx.service.count.mockResolvedValueOnce(0);
    await expect(
      saveSetupProfessional({
        id: "pro-a",
        serviceIds: ["foreign"],
        applyHours: true,
      }),
    ).rejects.toThrow("serviços ativos");
    expect(m.tx.workingHours.createMany).not.toHaveBeenCalled();
    m.tx.service.findFirst.mockResolvedValue(null);
    await expect(
      saveSetupService({
        id: "foreign",
        name: "Corte",
        durationMin: 30,
        priceCents: 5000,
        freeConfirmed: false,
      }),
    ).rejects.toThrow("Serviço não encontrado");
  });
  it("cópia explícita só cria jornada ausente, sem substituir existente", async () => {
    m.tx.workingHours.count.mockResolvedValueOnce(2);
    await expect(
      saveSetupProfessional({
        id: "pro-a",
        serviceIds: ["s1"],
        applyHours: true,
      }),
    ).rejects.toThrow("já tem uma jornada");
    expect(m.tx.workingHours.createMany).not.toHaveBeenCalled();
    await saveSetupProfessional({
      id: "pro-a",
      serviceIds: ["s1"],
      applyHours: true,
    });
    expect(m.tx.workingHours.createMany).toHaveBeenCalledWith({
      data: [
        {
          salonId: "salon-a",
          professionalId: "pro-a",
          weekday: 1,
          startMinutes: 540,
          endMinutes: 1080,
        },
      ],
    });
  });
  it("não conclui com pendências, mas permite adiar", async () => {
    await expect(
      saveSetupProgress({ step: 3, status: "completed" }),
    ).rejects.toThrow("Revise horários");
    await saveSetupProgress({ step: 3, status: "deferred" });
    expect(m.audit).toHaveBeenCalledTimes(1);
  });
  it("ativação pessoal é idempotente e respeita capacidade inclusive convites", async () => {
    await enableMySetupAgenda();
    expect(m.tx.professional.create).not.toHaveBeenCalled();
    m.tx.professional.findFirst.mockResolvedValue(null);
    m.tx.professional.count.mockResolvedValue(1);
    m.tx.userInvite.count.mockResolvedValue(1);
    m.capacity.mockImplementation(() => {
      throw new Error("Limite de agendas");
    });
    await expect(enableMySetupAgenda()).rejects.toThrow("Limite");
    expect(m.capacity).toHaveBeenCalledWith({
      plan: "FREE",
      activeProfessionals: 1,
      pendingProfessionalInvites: 1,
    });
    expect(m.tx.professional.create).not.toHaveBeenCalled();
  });
});
