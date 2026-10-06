import { addCalendarDays } from "../../../src/lib/time";

/** Gate 3.1B V2: backend-reviewed functional equivalents of the frozen V1 cases.
 * This manifest is local evaluation data. Never append fixture_refs or expected to a model request.
 */
export const GPT6_V2_VERSION = "gpt6-luna-golden-v2.1" as const;
export const GPT6_V2_TIMEZONE = "America/Sao_Paulo" as const;
export const GPT6_V2_CASE_IDS = [
  "services-create", "services-price", "customers-create", "scheduling-create",
  "scheduling-change", "scheduling-batch", "financial-revenue", "inventory-low",
  "communication-exact", "communication-dependent-name",
] as const;
export type Gpt6V2CaseId = typeof GPT6_V2_CASE_IDS[number];
export type Gpt6V2Case = {
  case_id: Gpt6V2CaseId;
  message: string;
  base_date: string;
  fixture_refs: Record<string, string>;
  preconditions: string[];
  expected: {
    skills: string[];
    operations: string[];
    fields: Record<string, unknown>;
    dependencies: { from: number; to: number }[];
    backend_resolution: string[];
    proposal_state: "NEEDS_INPUT" | "PROPOSED" | "READ_ONLY";
    confirmation_allowed: false;
  };
  historical: { case_id: Gpt6V2CaseId; model: "gpt-5.6-luna"; comparability: "FUNCTIONALLY_EQUIVALENT" };
};
export type Gpt6V2Manifest = {
  version: typeof GPT6_V2_VERSION;
  base_date: string;
  timezone: typeof GPT6_V2_TIMEZONE;
  tomorrow: string;
  yesterday: string;
  cases: Gpt6V2Case[];
};

export function gpt6V2Ref(baseDate: string, caseId: Gpt6V2CaseId, entity: string) {
  return `g6v2-${baseDate.replaceAll("-", "")}-${caseId}-${entity}`;
}

export function createGpt6V2Manifest(baseDate: string): Gpt6V2Manifest {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || new Date(`${baseDate}T12:00:00Z`).toISOString().slice(0, 10) !== baseDate)
    throw Error("GPT6_V2_INVALID_BASE_DATE");
  const tomorrow = addCalendarDays(baseDate, 1), yesterday = addCalendarDays(baseDate, -1);
  const make = (case_id: Gpt6V2CaseId, message: string, refs: string[], preconditions: string[],
    skills: string[], operations: string[], fields: Record<string, unknown>,
    dependencies: { from: number; to: number }[], backend_resolution: string[],
    proposal_state: Gpt6V2Case["expected"]["proposal_state"]): Gpt6V2Case => ({
    case_id, message, base_date: baseDate,
    fixture_refs: Object.fromEntries(["salon", "owner", ...refs].map(entity => [entity, gpt6V2Ref(baseDate, case_id, entity)])),
    preconditions,
    expected: { skills, operations, fields, dependencies, backend_resolution, proposal_state, confirmation_allowed: false },
    historical: { case_id, model: "gpt-5.6-luna", comparability: "FUNCTIONALLY_EQUIVALENT" },
  });
  const cases = [
    make("services-create", "Cadastre uma massagem relaxante Aurora por R$50.", [],
      ["Massagem Relaxante Aurora não existe no catálogo", "duração não foi informada"],
      ["services"], ["service.create"], { name: "Massagem Relaxante Aurora", priceCents: 5000, missing: ["durationMin"] }, [],
      ["ausência de duplicata no tenant"], "NEEDS_INPUT"),
    make("services-price", "Altere o preço da Hidratação Capilar Aurora para R$80.", ["service"],
      ["Hidratação Capilar Aurora ativa, preço anterior R$60"],
      ["services"], ["service.change"], { priceCents: 8000, target_name: "Hidratação Capilar Aurora" }, [],
      ["service_ref somente do catálogo do backend"], "PROPOSED"),
    make("customers-create", "Cadastre Maria Clara de Alencar.", [],
      ["Maria Clara de Alencar ainda não existe"],
      ["customers"], ["customer.create"], { name: "Maria Clara de Alencar" }, [],
      ["ausência de duplicata de cliente no tenant"], "PROPOSED"),
    make("scheduling-create", "Marque Camila Lemos amanhã às 10h com Tatiana Almeida para Progressiva Aurora.",
      ["customer", "service", "professional"], ["cliente, serviço e profissional únicos", `slot ${tomorrow} 10:00 livre e elegível`],
      ["scheduling"], ["appointment.create"], { customer_name: "Camila Lemos", service_name: "Progressiva Aurora", professional_name: "Tatiana Almeida", date: tomorrow, time: "10:00" }, [],
      ["customer_ref", "service_ref", "professional_ref", "disponibilidade pelo backend"], "PROPOSED"),
    make("scheduling-change", "Passe a Amanda Ribeiro de amanhã às 10h para 11h.",
      ["customer", "service", "professional", "appointment"], ["Appointment próprio CONFIRMED às 10:00, versão 1", `11:00 em ${tomorrow} livre e elegível`],
      ["scheduling"], ["appointment.change"], { customer_name: "Amanda Ribeiro", source_date: tomorrow, source_time: "10:00", date: tomorrow, time: "11:00" }, [],
      ["appointment_ref", "customer_ref", "disponibilidade pelo backend"], "PROPOSED"),
    make("scheduling-batch", "Cancele a Amanda Batista de amanhã às 10h e coloque o Fábio Rocha nesse horário para corte masculino. Motivo: substituição solicitada pela equipe.",
      ["customer", "replacement_customer", "service", "replacement_service", "professional", "appointment"],
      ["Appointment da Amanda próprio CONFIRMED às 10:00, versão 1", "Fábio e Corte Masculino únicos", "slot da criação é projetado pela liberação do cancelamento"],
      ["scheduling"], ["appointment.cancel", "appointment.create"],
      { cancel_customer_name: "Amanda Batista", replacement_customer_name: "Fábio Rocha", service_name: "Corte Masculino", source_date: tomorrow, source_time: "10:00", reason: "substituição solicitada pela equipe", released_slot_of: 0 },
      [{ from: 0, to: 1 }], ["appointment_ref", "customer_ref", "service_ref", "professional_ref", "slot projetado pelo backend"], "PROPOSED"),
    make("financial-revenue", "Quanto faturei ontem?", ["customer", "service", "professional", "appointment", "payment"],
      [`atendimento COMPLETED em ${yesterday}, serviços R$120`, "Payment sintético R$80", "nenhum outro atendimento no tenant"],
      ["financial"], ["financial.report"], { metrics: ["service_revenue"], period: "yesterday", expected_value_cents: 12000 }, [],
      ["período absoluto no fuso do salão", "R$120 calculados exclusivamente por T09"], "READ_ONLY"),
    make("inventory-low", "Quais produtos estão com estoque baixo?", ["low_product", "normal_product"],
      ["Shampoo Aurora: stock=1, minStock=3", "Condicionador Aurora: stock=8, minStock=2", "nenhum outro produto no tenant"],
      ["inventory"], ["product.search"], { low_stock: true, expected_names: ["Shampoo Aurora"] }, [],
      ["T24/T26 aplicam stock <= minStock no PostgreSQL"], "READ_ONLY"),
    make("communication-exact", "Mande exatamente para o Fábio Nogueira no WhatsApp: “Serviço cancelado, Fábio.”",
      ["customer"], ["cliente único com telefone sintético válido", "nenhuma Outbox existente"],
      ["communication"], ["customer.message"], { recipient_name: "Fábio Nogueira", channel: "WHATSAPP", message_mode: "EXACT", content: "Serviço cancelado, Fábio." }, [],
      ["recipient_ref e contato somente pelo backend", "preview byte a byte"], "PROPOSED"),
    make("communication-dependent-name", "Cancele a Amanda Maria de Souza de amanhã às 14h e mande exatamente no WhatsApp: “Amanda, seu horário foi cancelado.” Motivo: teste controlado.",
      ["customer", "service", "professional", "appointment"], ["cliente de nome composto único e contato sintético válido", `Appointment próprio CONFIRMED em ${tomorrow} 14:00`, "nenhuma Outbox existente"],
      ["scheduling", "communication"], ["appointment.cancel", "customer.message"],
      { customer_name: "Amanda Maria de Souza", recipient_name: "Amanda Maria de Souza", service_name: null, source_date: tomorrow, source_time: "14:00", message_mode: "EXACT", channel: "WHATSAPP", content: "Amanda, seu horário foi cancelado.", reason: "teste controlado" },
      [{ from: 0, to: 1 }], ["appointment_ref e recipient_ref do mesmo cliente", "service_ref não extraído sem menção"], "PROPOSED"),
  ];
  if (cases.length !== 10 || cases.some((item, i) => item.case_id !== GPT6_V2_CASE_IDS[i])) throw Error("GPT6_V2_CASE_ORDER");
  return { version: GPT6_V2_VERSION, base_date: baseDate, timezone: GPT6_V2_TIMEZONE, tomorrow, yesterday, cases };
}
