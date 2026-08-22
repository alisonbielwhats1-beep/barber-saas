import type { Plan } from "@prisma/client";

/**
 * Regras comerciais da plataforma. O plano persistido continua sendo a fonte
 * de verdade do tenant; este módulo concentra os limites para que a UI e as
 * Server Actions não acabem usando números diferentes.
 */
export type PlanFeature = "MARKETING" | "INVENTORY" | "PACKAGES";

export type PlanEntitlement = {
  label: string;
  priceCents: number;
  maxProfessionals: number;
  monthlyAppointments: number | null;
  features: Record<PlanFeature, boolean>;
};

export const EXTRA_PROFESSIONAL_PRICE_CENTS = 1_990;

export const PLAN_ENTITLEMENTS: Record<Plan, PlanEntitlement> = {
  FREE: {
    label: "Grátis",
    priceCents: 0,
    maxProfessionals: 1,
    monthlyAppointments: 30,
    features: { MARKETING: false, INVENTORY: false, PACKAGES: false },
  },
  STARTER: {
    label: "Fundador",
    priceCents: 4_990,
    maxProfessionals: 2,
    monthlyAppointments: null,
    features: { MARKETING: true, INVENTORY: true, PACKAGES: true },
  },
  PRO: {
    label: "Pro",
    priceCents: 7_990,
    maxProfessionals: 3,
    monthlyAppointments: null,
    features: { MARKETING: true, INVENTORY: true, PACKAGES: true },
  },
  ENTERPRISE: {
    label: "Equipe",
    priceCents: 17_990,
    maxProfessionals: 10,
    monthlyAppointments: null,
    features: { MARKETING: true, INVENTORY: true, PACKAGES: true },
  },
};

export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export function getPlanEntitlement(plan: Plan | string | null | undefined): PlanEntitlement {
  return PLAN_ENTITLEMENTS[(plan as Plan) ?? "FREE"] ?? PLAN_ENTITLEMENTS.FREE;
}

export function canUsePlanFeature(
  plan: Plan | string | null | undefined,
  feature: PlanFeature,
): boolean {
  return getPlanEntitlement(plan).features[feature];
}

export function assertPlanFeature(
  plan: Plan | string | null | undefined,
  feature: PlanFeature,
): void {
  if (canUsePlanFeature(plan, feature)) return;
  const label = feature === "MARKETING" ? "marketing" : feature === "INVENTORY" ? "estoque" : "pacotes e planos";
  throw new PlanLimitError(`O recurso de ${label} está disponível a partir do plano Fundador.`);
}

export function assertProfessionalCapacity(input: {
  plan: Plan | string | null | undefined;
  activeProfessionals: number;
  pendingProfessionalInvites?: number;
}): void {
  const entitlement = getPlanEntitlement(input.plan);
  const pending = input.pendingProfessionalInvites ?? 0;
  if (input.activeProfessionals + pending < entitlement.maxProfessionals) return;
  throw new PlanLimitError(
    `O plano ${entitlement.label} permite até ${entitlement.maxProfessionals} ${entitlement.maxProfessionals === 1 ? "agenda ativa" : "agendas ativas"}. Faça upgrade para adicionar outra.`,
  );
}

export function assertMonthlyAppointmentCapacity(input: {
  plan: Plan | string | null | undefined;
  appointmentsThisMonth: number;
}): void {
  const limit = getPlanEntitlement(input.plan).monthlyAppointments;
  if (limit === null || input.appointmentsThisMonth < limit) return;
  throw new PlanLimitError(
    `O plano Grátis permite até ${limit} agendamentos por mês. Faça upgrade para continuar recebendo reservas.`,
  );
}

export const PLAN_PRICING_ROWS = [
  { plan: "FREE" as const, title: "Grátis", price: "R$ 0", professionals: "1 agenda", detail: "30 agendamentos/mês" },
  { plan: "STARTER" as const, title: "Fundador", price: "R$ 49,90", professionals: "2 agendas", detail: "Preço para os 10 primeiros" },
  { plan: "PRO" as const, title: "Pro", price: "R$ 79,90", professionals: "3 agendas", detail: "Sem taxa por cliente" },
  { plan: "ENTERPRISE" as const, title: "Equipe", price: "R$ 179,90", professionals: "Até 10 agendas", detail: `Agenda extra: R$ ${(EXTRA_PROFESSIONAL_PRICE_CENTS / 100).toFixed(2).replace(".", ",")}/mês` },
];
