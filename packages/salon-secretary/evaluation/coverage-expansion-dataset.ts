import { dataset, validateDataset } from "./dataset";
import { operationSkill, type Decision, type EvaluationCase } from "./contract";

export type ExpansionCase = EvaluationCase & { wave: 1 | 2 | 3 | 4; tag: "DIRECT" | "PARAPHRASE" | "PERIOD" | "NEIGHBOR" | "AMBIGUOUS" | "COMPOUND" | "OUTSIDE" | "MUTATION" | "OPEN_FIELDS"; baseline: string | null };
type Tag = ExpansionCase["tag"];
const tags: readonly Tag[] = ["DIRECT", "PARAPHRASE", "PERIOD", "NEIGHBOR", "AMBIGUOUS", "COMPOUND", "OUTSIDE", "MUTATION", "OPEN_FIELDS"];
const base: Decision = { skill: "out_of_catalog", shape: "out_of_catalog", operation: "out_of_catalog", period: "none", metric: "none", inventory: "none", communication: "none" };
function make(id: string, wave: ExpansionCase["wave"], tag: Tag, message: string, changes: Partial<Decision>, ops: EvaluationCase["expected"]["operations"], open: boolean, fields: Record<string, unknown>, baseline: string | null = null): ExpansionCase {
  const decision = { ...base, ...changes };
  const skillSet = [...new Set(ops.map(operationSkill))] as EvaluationCase["expected"]["skills"];
  return { id, wave, tag, baseline, category: tag === "OUTSIDE" ? "D" : open ? "C" : "B", input: { message, context: {} },
    expected: { decision, skills: skillSet, operations: ops, dependencies: decision.shape === "dependent" ? [{ from: 0, to: 1 }] : [], requiresOpenExtraction: open, domainFields: fields },
    evidence: [{ path: `packages/salon-secretary/src/${skillSet[0] ?? ({ 1: "financial", 2: "inventory", 3: "services", 4: "communication" } as const)[wave]}-skill.ts`, anchor: "published manual/schema", kind: "domain_test", note: "New synthetic oracle reviewed against published selectors; not an observed JEV output" },
      ...(baseline ? dataset.find(c => c.id === baseline)!.evidence : [])] };
}
function clone(id: string, wave: ExpansionCase["wave"], tag: Tag, baseline: string): ExpansionCase {
  const c = structuredClone(dataset.find(c => c.id === baseline)!);
  return { ...c, id, wave, tag, baseline };
}
function financial(id: string, tag: Tag, message: string, metric: Decision["metric"], period: Decision["period"], open = false, fields: Record<string, unknown> = {}) {
  return make(id, 1, tag, message, { skill: "financial", shape: "single", operation: "financial.report", metric, period }, ["financial.report"], open,
    { metrics: metric === "unclear" ? null : [metric], period: period === "none" ? null : period, ...fields }, metric === "received_revenue" ? "financial-received" : metric === "outstanding_receivables" ? "financial-outstanding" : metric === "service_revenue" ? "financial-revenue" : metric === "average_ticket" ? "financial-multiple" : null);
}
function inventory(id: string, tag: Tag, message: string, intent: Decision["inventory"], operation: "product.search" | "stock.balance" | "stock.movement", open: boolean, fields: Record<string, unknown>) {
  return make(id, 2, tag, message, { skill: "inventory", shape: "single", operation, inventory: intent }, [operation], open, fields,
    intent === "low_stock" ? "inventory-low" : intent === "balance" ? "inventory-balance" : intent === "IN" ? "inventory-in" : intent === "OUT" ? "inventory-out-missing" : null);
}
/** New oracles only. The original forty cases and their expected values are never mutated. */
export const expansionDataset: ExpansionCase[] = [
  financial("f01", "DIRECT", "Quanto faturei ontem?", "service_revenue", "yesterday"),
  financial("f02", "PARAPHRASE", "Qual foi meu faturamento de ontem?", "service_revenue", "yesterday"),
  financial("f03", "PERIOD", "Qual foi o faturamento de serviços concluídos esta semana?", "service_revenue", "this_week"),
  financial("f04", "DIRECT", "Quanto eu recebi ontem?", "received_revenue", "yesterday"),
  financial("f05", "PARAPHRASE", "Qual o total dos pagamentos recebidos ontem?", "received_revenue", "yesterday"),
  financial("f06", "PERIOD", "Quanto recebi este mês?", "received_revenue", "this_month"),
  financial("f07", "DIRECT", "Quanto tenho a receber?", "outstanding_receivables", "none"),
  financial("f08", "PARAPHRASE", "Qual é o saldo atual a receber dos atendimentos concluídos ainda sem pagamento?", "outstanding_receivables", "none"),
  financial("f09", "PARAPHRASE", "Qual o valor em aberto dos atendimentos concluídos sem pagamento, incluindo serviços e produtos?", "outstanding_receivables", "none"),
  financial("f10", "DIRECT", "Qual foi meu ticket médio ontem?", "average_ticket", "yesterday"),
  financial("f11", "PARAPHRASE", "Qual foi o faturamento médio de serviços por atendimento concluído ontem?", "average_ticket", "yesterday"),
  financial("f12", "PERIOD", "Qual foi meu ticket médio no mês passado?", "average_ticket", "last_month"),
  financial("f13", "DIRECT", "Qual a receita realizada com serviços e produtos dos atendimentos concluídos ontem?", "realized_revenue", "yesterday"),
  financial("f14", "PARAPHRASE", "Quanto totalizaram serviços e produtos dos atendimentos concluídos ontem?", "realized_revenue", "yesterday"),
  financial("f15", "PERIOD", "Qual foi o faturamento incluindo produtos na semana passada?", "realized_revenue", "last_week"),
  financial("f16", "DIRECT", "Quantos atendimentos foram concluídos ontem?", "completed_count", "yesterday"),
  financial("f17", "PARAPHRASE", "Qual a quantidade de atendimentos finalizados ontem?", "completed_count", "yesterday"),
  financial("f18", "PERIOD", "Quantos atendimentos foram concluídos hoje?", "completed_count", "today"),
  financial("f19", "AMBIGUOUS", "Quanto faturei?", "service_revenue", "none", true, { missing: ["period"] }),
  financial("f20", "AMBIGUOUS", "Quanto entrou ontem?", "unclear", "yesterday", true, { missing: ["metric"] }),
  financial("f21", "NEIGHBOR", "Quanto eu tinha a receber ontem?", "outstanding_receivables", "yesterday", true, { unsupported: "historical receivables" }),
  clone("f22", 1, "NEIGHBOR", "financial-comparison"),
  financial("f23", "OPEN_FIELDS", "Qual profissional faturou mais este mês?", "service_revenue", "this_month", true, { group_by: "professional" }),
  financial("f24", "OPEN_FIELDS", "Qual serviço mais faturou ontem?", "service_revenue", "yesterday", true, { group_by: "service" }),
  clone("f25", 1, "COMPOUND", "compound-financial-services"),
  make("f26", 1, "COMPOUND", "Quanto faturei ontem e cancele a Amanda amanhã?", { skill: "multiple", shape: "independent", operation: "multiple", metric: "service_revenue", period: "yesterday" }, ["financial.report", "appointment.cancel"], true, { customer_name: "Amanda", missing: ["reason"] }),
  clone("f27", 1, "OUTSIDE", "outside-financial-write"),
  make("f28", 1, "OUTSIDE", "Qual foi meu lucro líquido ontem?", { metric: "unclear", period: "yesterday" }, [], false, { unsupported: "profit" }),
  make("f29", 1, "OUTSIDE", "Quais taxas foram descontadas dos pagamentos ontem?", { metric: "unclear", period: "yesterday" }, [], false, { unsupported: "fees" }),
  make("f30", 1, "OUTSIDE", "Dê baixa no pagamento pendente da Amanda.", { metric: "unclear" }, [], false, { unsupported: "financial mutation" }),
  financial("f31", "NEIGHBOR", "Quanto faturei e quanto recebi ontem?", "multiple", "yesterday", true, { metrics: ["service_revenue", "received_revenue"] }),
  financial("f32", "AMBIGUOUS", "Quanto vendi ontem?", "unclear", "yesterday", true, { missing: ["services/products/payment semantics"] }),
  inventory("i01", "DIRECT", "Quais produtos estão com estoque baixo?", "low_stock", "product.search", false, { low_stock: true }),
  inventory("i02", "PARAPHRASE", "Quais produtos estão no estoque mínimo ou abaixo dele?", "low_stock", "product.search", false, { low_stock: true }),
  inventory("i03", "PARAPHRASE", "Liste os produtos com saldo menor ou igual ao mínimo configurado.", "low_stock", "product.search", false, { low_stock: true }),
  inventory("i04", "NEIGHBOR", "Quantas unidades do Shampoo X eu tenho?", "balance", "stock.balance", true, { product_name: "Shampoo X" }),
  inventory("i05", "PARAPHRASE", "Qual o saldo do Shampoo X?", "balance", "stock.balance", true, { product_name: "Shampoo X" }),
  inventory("i06", "OPEN_FIELDS", "Procure o Shampoo X no catálogo de produtos.", "search", "product.search", true, { product_name: "Shampoo X" }),
  inventory("i07", "OPEN_FIELDS", "Localize o Condicionador Teste.", "search", "product.search", true, { product_name: "Condicionador Teste" }),
  inventory("i08", "MUTATION", "Entraram 10 unidades do Shampoo X.", "IN", "stock.movement", true, { product_name: "Shampoo X", quantity: 10 }),
  inventory("i09", "MUTATION", "Dê baixa em 3 unidades do Shampoo X.", "OUT", "stock.movement", true, { product_name: "Shampoo X", quantity: 3 }),
  inventory("i10", "MUTATION", "Dê entrada no Shampoo X.", "IN", "stock.movement", true, { product_name: "Shampoo X", missing: ["quantity"] }),
  inventory("i11", "AMBIGUOUS", "Confira o estoque.", "unclear", "product.search", true, { missing: ["intent/product"] }),
  inventory("i12", "NEIGHBOR", "Quais produtos estão com saldo zero?", "search", "product.search", true, { unsupported: "stock=0 filter; not equivalent to low_stock" }),
  make("i13", 2, "COMPOUND", "Quais produtos estão com estoque baixo e dê entrada em 10 Shampoo X?", { skill: "inventory", shape: "independent", operation: "multiple", inventory: "unclear" }, ["product.search", "stock.movement"], true, { low_stock: true, mode: "IN", quantity: 10, product_name: "Shampoo X" }),
  clone("i14", 2, "COMPOUND", "compound-financial-inventory"),
  make("i15", 2, "OUTSIDE", "Compre automaticamente os produtos com estoque baixo.", { inventory: "unclear" }, [], false, { unsupported: "purchase" }),
  make("i16", 2, "OUTSIDE", "Cadastre o produto Shampoo Teste.", { inventory: "unclear" }, [], false, { unsupported: "product.create" }),
  clone("r01", 3, "MUTATION", "services-create"),
  clone("r02", 3, "MUTATION", "services-price"),
  clone("r03", 3, "MUTATION", "services-rename"),
  make("r04", 3, "OUTSIDE", "Desative o serviço Massagem.", {}, [], false, { unsupported: "service status unpublished" }),
  clone("r05", 3, "MUTATION", "customers-create"),
  clone("r06", 3, "MUTATION", "customers-phone"),
  clone("r07", 3, "OPEN_FIELDS", "customers-ambiguous"),
  make("r08", 3, "OPEN_FIELDS", "Busque Maria Clara de Souza no cadastro de clientes.", { skill: "customers", shape: "single", operation: "customer.search" }, ["customer.search"], true, { target_name: "Maria Clara de Souza" }, "customers-full-name"),
  clone("s01", 4, "MUTATION", "scheduling-create"),
  clone("s02", 4, "MUTATION", "scheduling-cancel"),
  clone("s03", 4, "COMPOUND", "scheduling-batch"),
  make("s04", 4, "OPEN_FIELDS", "Quais horários a Tatiana tem disponíveis amanhã para Progressiva?", { skill: "scheduling", shape: "single", operation: "availability.get" }, ["availability.get"], true, { professional_name: "Tatiana", service_name: "Progressiva", day_offset: 1 }, "scheduling-create"),
  clone("s05", 4, "OPEN_FIELDS", "communication-exact"),
  clone("s06", 4, "OPEN_FIELDS", "communication-generated"),
  clone("s07", 4, "COMPOUND", "communication-dependent-name"),
  clone("s08", 4, "AMBIGUOUS", "communication-missing-channel"),
];

export function validateExpansionDataset(cases: ExpansionCase[] = expansionDataset) {
  if (cases.length !== 64 || new Set(cases.map(c => c.id)).size !== 64 || new Set(cases.map(c => c.input.message)).size !== 64) throw Error("EXPANSION_DATASET_DRIFT");
  // Reuse the frozen schema in bounded chunks; its original fifty-case limit is untouched.
  for (let i = 0; i < cases.length; i += 40) validateDataset(cases.slice(i, i + 40).map(({ wave, tag, baseline, ...c }) => {
    if (![1, 2, 3, 4].includes(wave) || !tags.includes(tag) || (baseline !== null && !dataset.some(x => x.id === baseline))) throw Error("INVALID_EXPANSION_METADATA");
    return c;
  }));
  if ([1, 2, 3, 4].some((w, i) => cases.filter(c => c.wave === w).length !== [32, 16, 8, 8][i])) throw Error("WAVE_DRIFT");
  return cases;
}
