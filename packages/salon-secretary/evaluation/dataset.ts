import { z } from "zod";
import { decisionSchema, inputSchema, operationSkill, operations, skills, type Decision, type EvaluationCase } from "./contract";

const test = (file: string, anchor: string) => ({ path: `src/lib/__tests__/${file}.test.ts`, anchor, kind: "domain_test" as const, note: "Expected revisado contra o contrato/backend, não inferido de resposta futura do provedor." });
const real = (id: string) => ({ path: "src/test/fixtures/secretary-real-outputs.json", anchor: id, kind: "real_output" as const, note: "Evidência histórica de estrutura; mensagem adaptada não implica baseline pareado de latência." });
const gate = (n: string) => ({ path: `docs/SECRETARIA_GATE_2_${n}.md`, anchor: `Gate 2.${n}`, kind: "gate_report" as const, note: "Cenário/semântica comprovados no Gate; fixture sem IDs reais." });
function entry(id: string, category: EvaluationCase["category"], message: string, ops: EvaluationCase["expected"]["operations"], fields: EvaluationCase["expected"]["domainFields"], evidence: EvaluationCase["evidence"], changes: Partial<Decision> = {}, context: EvaluationCase["input"]["context"] = {}, requiresOpenExtraction = true): EvaluationCase {
  const selected = [...new Set(ops.map(operationSkill))] as EvaluationCase["expected"]["skills"];
  const decision: Decision = { skill: selected.length > 1 ? "multiple" : selected[0] ?? "out_of_catalog", operation: ops.length > 1 ? "multiple" : ops[0] ?? "out_of_catalog", shape: ops.length > 1 ? "independent" : ops.length ? "single" : "out_of_catalog", period: "none", metric: "none", inventory: "none", communication: "none", ...changes };
  return { id, category, input: { message, context }, expected: { decision, skills: selected, operations: ops, dependencies: decision.shape === "dependent" ? [{ from: 0, to: 1 }] : [], domainFields: fields, requiresOpenExtraction, ...(category === "A" ? { fastPathPatch: fields } : {}) }, evidence };
}
/** Frozen before any JEV inference. Context is minimal, synthetic and excludes refs. */
export const dataset: EvaluationCase[] = [
  entry("services-create", "B", "Cadastre uma massagem por R$50.", ["service.create"], { name: "Massagem", priceCents: 5000, missing: ["durationMin"] }, [test("secretary-service-name-flow", "massagem"), real("gate21-0")]),
  entry("services-price", "B", "Altere o preço da massagem para R$80.", ["service.change"], { target_name: "massagem", priceCents: 8000 }, [test("service-change.integration", "price"), real("gate21-3")]),
  entry("services-duration", "A", "45 minutos", ["service.create"], { durationMin: 45 }, [test("secretary-fast-path", "45 minutos")], {}, { operation: "service.create", waiting_for: "durationMin" }, false),
  entry("services-rename", "C", "Altere Massagem para Massagem Relaxante.", ["service.change"], { target_name: "Massagem", name: "Massagem Relaxante" }, [test("service-change.integration", "name")]),
  entry("customers-create", "B", "Cadastre Amanda Souza.", ["customer.create"], { name: "Amanda Souza", missing: [] }, [real("gate21-2"), test("secretary-customers-flow", "Amanda")]),
  entry("customers-phone", "B", "Altere o telefone da Amanda.", ["customer.change"], { target_name: "Amanda", requested_fields: ["phone"] }, [test("secretary-customers-flow", "phone")]),
  entry("customers-email", "B", "Mude o e-mail da Amanda Souza.", ["customer.change"], { target_name: "Amanda Souza", requested_fields: ["email"] }, [test("secretary-customers-flow", "email")]),
  entry("customers-full-name", "C", "Cadastre Maria Clara de Souza.", ["customer.create"], { name: "Maria Clara de Souza" }, [test("scheduling-entity-mentions", "Maria Clara de Souza"), test("secretary-customers", "name")]),
  entry("customers-ambiguous", "C", "Quem é a Amanda?", ["customer.read"], { target_name: "Amanda", resolution: "backend_must_disambiguate_if_multiple" }, [test("secretary-customers.integration", "ambig")]),
  entry("scheduling-create", "C", "Marque Amanda amanhã às 10h com Tatiana para Progressiva.", ["appointment.create"], { customer_name: "Amanda", professional_name: "Tatiana", service_name: "Progressiva", day_offset: 1, time: "10:00" }, [real("gate22-0"), test("secretary-scheduling.integration", "create")]),
  entry("scheduling-cancel", "B", "Cancele a Beatriz amanhã às 14h. Motivo: teste controlado.", ["appointment.cancel"], { customer_name: "Beatriz", day_offset: 1, time: "14:00", reason: "teste controlado" }, [real("gate23-1"), gate("3")]),
  entry("scheduling-change", "C", "Passe a Amanda de amanhã às 10h para 11h.", ["appointment.change"], { customer_name: "Amanda", source_day_offset: 1, source_time: "10:00", time: "11:00" }, [real("gate23-0"), gate("3")]),
  entry("scheduling-block", "C", "Bloqueie a agenda da Tatiana amanhã das 13h às 15h.", ["schedule.block"], { professional_name: "Tatiana", day_offset: 1, time: "13:00", end_time: "15:00" }, [real("gate23-2"), gate("3")]),
  entry("scheduling-occupied", "C", "Marque Amanda amanhã às 10h para Progressiva.", ["appointment.create"], { customer_name: "Amanda", service_name: "Progressiva", day_offset: 1, time: "10:00", availability: "backend_only_conflict_fixture" }, [real("gate22-2"), test("secretary-scheduling.integration", "unavailable slot returns real alternatives")]),
  entry("scheduling-missing-service", "C", "Progressiva.", ["appointment.create"], { service_name: "Progressiva", preserve: ["customer", "date", "time"] }, [test("secretary-scheduling.integration", "same draft"), gate("2")], {}, { operation: "appointment.create", waiting_for: "service" }),
  entry("scheduling-ambiguous-period", "C", "depois do almoço", ["appointment.change"], { period: "afternoon", time: "must_not_invent", status: "NEEDS_INPUT" }, [real("gate23-4"), test("scheduling-temporal", "TIME_OUTSIDE_PERIOD")], {}, { operation: "appointment.change", waiting_for: "time" }),
  entry("scheduling-batch", "C", "Cancele a Amanda das 10h e coloque o Fábio nesse horário para corte masculino. Motivo: substituição solicitada pela equipe.", ["appointment.cancel", "appointment.create"], { customer_names: ["Amanda", "Fábio"], service_name: "corte masculino", released_slot_of: 0 }, [real("gate24-0"), test("scheduling-batch", "depend")], { shape: "dependent" }),
  entry("scheduling-time", "A", "11h", ["appointment.change"], { time: "11:00" }, [test("secretary-fast-path", "11h")], {}, { operation: "appointment.change", waiting_for: "time" }, false),
  entry("scheduling-date", "A", "amanhã", ["appointment.create"], { day_offset: 1 }, [test("secretary-fast-path", "tomorrow")], {}, { operation: "appointment.create", waiting_for: "date" }, false),
  entry("financial-revenue", "B", "Quanto faturei ontem?", ["financial.report"], { metrics: ["service_revenue"], period: "yesterday" }, [real("gate25-0"), real("gate25-boundary-0"), test("secretary-financial.integration", "comparison backend math")], { period: "yesterday", metric: "service_revenue" }, {}, false),
  entry("financial-received", "B", "Quanto eu recebi ontem?", ["financial.report"], { metrics: ["received_revenue"], period: "yesterday" }, [gate("5"), test("secretary-financial.integration", "paidAt")], { period: "yesterday", metric: "received_revenue" }, {}, false),
  entry("financial-outstanding", "B", "Quanto tenho a receber?", ["financial.report"], { metrics: ["outstanding_receivables"], period: null }, [gate("5"), test("secretary-financial.integration", "outstanding")], { metric: "outstanding_receivables" }, {}, false),
  entry("financial-comparison", "B", "Compare esta semana com a semana passada.", ["financial.report"], { metrics: ["service_revenue"], period: "this_week", compare_period: "last_week" }, [test("secretary-financial", "comparison"), gate("5")], { period: "comparison", metric: "service_revenue" }, {}, true),
  entry("financial-multiple", "C", "Qual profissional faturou mais este mês, qual serviço mais faturou e qual foi meu ticket médio?", ["financial.report", "financial.report", "financial.report"], { metrics: ["service_revenue", "average_ticket"], group_by: ["professional", "service"], period: "this_month" }, [gate("5"), test("secretary-financial.integration", "average_ticket")], { period: "this_month", metric: "multiple" }),
  entry("inventory-balance", "B", "Quantas unidades do Shampoo X eu tenho?", ["stock.balance"], { product_name: "Shampoo X" }, [gate("6"), test("secretary-inventory", "stock.balance")], { inventory: "balance" }),
  entry("inventory-low", "B", "Quais produtos estão com estoque baixo?", ["product.search"], { low_stock: true }, [gate("6"), test("secretary-inventory", "low_stock")], { inventory: "low_stock" }, {}, false),
  entry("inventory-in", "B", "Entraram 10 unidades do Shampoo X.", ["stock.movement"], { product_name: "Shampoo X", mode: "IN", quantity: 10 }, [test("secretary-inventory", "Entraram 10 unidades"), gate("6")], { inventory: "IN" }),
  entry("inventory-out-missing", "B", "Dê baixa no Shampoo Y.", ["stock.movement"], { product_name: "Shampoo Y", mode: "OUT", missing: ["quantity"] }, [gate("6"), test("secretary-inventory.integration", "quantity")], { inventory: "OUT" }),
  entry("inventory-quantity", "A", "3", ["stock.movement"], { quantity: 3 }, [test("secretary-inventory", "safe positive integer")], { inventory: "OUT" }, { operation: "stock.movement", waiting_for: "quantity", inventory_mode: "OUT" }, false),
  entry("communication-exact", "C", "Mande exatamente para o Fábio no WhatsApp: “Serviço cancelado, Fábio.”", ["customer.message"], { recipient_name: "Fábio", channel: "WHATSAPP", message_mode: "EXACT", content: "Serviço cancelado, Fábio." }, [gate("7"), test("secretary-communication", "EXACT")], { communication: "EXACT" }),
  entry("communication-generated", "C", "Avise educadamente o Fábio pelo WhatsApp que o horário dele foi cancelado.", ["customer.message"], { recipient_name: "Fábio", channel: "WHATSAPP", message_mode: "GENERATED", content: "requires_review_not_fixed_text" }, [gate("7"), test("secretary-communication", "GENERATED")], { communication: "GENERATED" }),
  entry("communication-missing-channel", "C", "Avise o Fábio que o horário dele mudou.", ["customer.message"], { recipient_name: "Fábio", channel: null, content: "do_not_generate_without_explicit_request" }, [gate("7"), test("secretary-communication", "channel")], { communication: "unspecified" }),
  entry("communication-channel", "A", "WhatsApp", ["customer.message"], { channel: "WHATSAPP" }, [test("secretary-communication", "fast-path")], { communication: "unspecified" }, { operation: "customer.message", waiting_for: "channel" }, false),
  entry("communication-dependent-name", "C", "Cancele a Amanda Communication Sintética de amanhã às 14h e mande exatamente no WhatsApp: “Amanda, seu horário foi cancelado.” Motivo: teste controlado.", ["appointment.cancel", "customer.message"], { customer_name: "Amanda Communication Sintética", recipient_name: "Amanda Communication Sintética", service_name: null, message_mode: "EXACT", content: "Amanda, seu horário foi cancelado." }, [real("gate27-communication-entity-split"), test("scheduling-entity-mentions", "Amanda Communication Sintética"), test("secretary-communication.integration", "Amanda Communication Sintética")], { shape: "dependent", communication: "EXACT" }),
  entry("compound-financial-services", "C", "Quanto faturei ontem e altere a massagem para R$80?", ["financial.report", "service.change"], { period: "yesterday", target_name: "massagem", priceCents: 8000 }, [test("secretary-financial", "independent Services")], { period: "yesterday", metric: "service_revenue" }),
  entry("compound-financial-inventory", "C", "Quanto faturei ontem e dê entrada em 10 Shampoo X.", ["financial.report", "stock.movement"], { period: "yesterday", product_name: "Shampoo X", quantity: 10, mode: "IN" }, [test("secretary-inventory", "Financial + Inventory")], { period: "yesterday", metric: "service_revenue", inventory: "IN" }),
  entry("compound-customers-services", "C", "Cadastre Amanda Souza e altere a massagem para R$80.", ["customer.create", "service.change"], { name: "Amanda Souza", target_name: "massagem", priceCents: 8000 }, [real("gate21-3"), test("secretary-registry", "compound")]),
  entry("outside-financial-write", "D", "Estorne o pagamento da Amanda.", [], { rejection: "financial_write_unpublished" }, [test("secretary-financial", "write operations")], { metric: "unclear" }, {}, false),
  entry("outside-roles", "D", "Mude meu papel para OWNER.", [], { rejection: "credentials_roles_unpublished" }, [test("secretary-customers", "role")], {}, {}, false),
  entry("outside-campaign", "D", "Envie uma campanha por SMS para todos os clientes.", [], { rejection: "external_campaign_unpublished" }, [gate("7")], {}, {}, false),
];

for (const c of dataset.filter(c => c.id.startsWith("financial-") || c.id === "communication-dependent-name")) {
  c.evidence.push({ path: "packages/salon-secretary/evaluation/luna-baselines.json", anchor: c.id, kind: "real_output", note: "Projeção sanitizada de sucesso real validado pelo backend. O output de fragmentação anterior é negativo; não é gabarito." });
}

const caseSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/), category: z.enum(["A", "B", "C", "D"]), input: inputSchema,
  expected: z.object({ decision: decisionSchema, skills: z.array(z.enum(skills)), operations: z.array(z.enum(operations)), dependencies: z.array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }).strict()), domainFields: z.record(z.string(), z.unknown()), requiresOpenExtraction: z.boolean(), fastPathPatch: z.record(z.string(), z.unknown()).optional() }).strict(),
  evidence: z.array(z.object({ path: z.string().min(1), anchor: z.string().min(1), kind: z.enum(["real_output", "domain_test", "gate_report"]), note: z.string().min(1) }).strict()).min(1),
}).strict();
export function validateDataset(input: unknown): EvaluationCase[] {
  const cases = z.array(caseSchema).min(1).max(50).parse(input);
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw Error("DUPLICATE_CASE");
  for (const c of cases) {
    const e = c.expected;
    if (Object.keys(e.domainFields).length === 0) throw Error("EXPECTED_INCOMPLETE");
    if ([...new Set(e.operations.map(operationSkill))].sort().join() !== [...e.skills].sort().join()) throw Error("EXPECTED_SKILLS");
    if (c.category === "A" && (!e.fastPathPatch || !c.input.context.waiting_for || !c.input.context.operation)) throw Error("FAST_PATH_CONTEXT");
    if (c.category === "D" && (e.operations.length || e.decision.shape !== "out_of_catalog")) throw Error("OUT_OF_CATALOG_EXPECTED");
    if ((e.decision.shape === "dependent") !== (e.dependencies.length > 0)) throw Error("EXPECTED_DEPENDENCY");
    const visiting = new Set<number>(), visited = new Set<number>();
    const visit = (n: number) => { if (visiting.has(n)) throw Error("DEPENDENCY_CYCLE"); if (visited.has(n)) return; visiting.add(n); for (const edge of e.dependencies.filter(x => x.to === n)) { if (edge.from >= e.operations.length || edge.to >= e.operations.length || edge.from === edge.to) throw Error("INVALID_DEPENDENCY"); visit(edge.from); } visiting.delete(n); visited.add(n); };
    for (const edge of e.dependencies) { if (edge.from >= e.operations.length || edge.to >= e.operations.length) throw Error("INVALID_DEPENDENCY"); visit(edge.to); }
  }
  return cases;
}
