import "server-only";
import { EXTRA_PROFESSIONAL_PRICE_CENTS, PLAN_ENTITLEMENTS, PLAN_PRICING_ROWS } from "@/lib/plan-entitlements";

// Public commercial data from the same version of the code as the landing.
// No tenant lookup, private records, tools, or duplicated price definitions.
export function orchestratorKnowledge() {
  return {
    product: "Everflair", source: "application_public_plan_catalog", currency: "BRL", billingPeriod: "month",
    plans: PLAN_PRICING_ROWS.map(row => ({ ...row, ...PLAN_ENTITLEMENTS[row.plan],
      // In the domain null means unlimited, not unknown. Preserve that meaning.
      monthlyAppointmentsDescription: PLAN_ENTITLEMENTS[row.plan].monthlyAppointments === null
        ? "Agendamentos ilimitados por mês" : `${PLAN_ENTITLEMENTS[row.plan].monthlyAppointments} agendamentos por mês`,
    })),
    extraProfessionalPriceCents: EXTRA_PROFESSIONAL_PRICE_CENTS,
    founderAvailability: "not_checked",
    signup: "A conta começa no Grátis, sem cobrança no cadastro. Upgrade depende de confirmação da plataforma.",
    limits: "Catálogo público desta versão do aplicativo. Não comprova disponibilidade da oferta Fundador nem o plano contratado por um cliente. Não contém catálogo de serviços, preços ou dados de salões. Não há consulta ou alteração de conta disponível neste teste.",
  };
}
