import type { ActionPlan, PlanAction } from "./action-plan";

/** Ephemeral display hints from an already resolved adapter. Never persisted in a plan. */
export type ClarificationHint = { fields?: readonly string[]; question?: string; selection?: { field: string; labels: readonly string[] };
  notice?: string; previewGroup?: string };
export type PresentationHints = Readonly<Record<string, ClarificationHint>>;
const aliases: Record<string, string> = {
  service_ref: "service", service_name: "service", customer_ref: "customer", customer_name: "customer",
  customer_id: "customer", professional_ref: "professional", professional_name: "professional", professional_id: "professional",
  appointment_ref: "appointment", recipient_name: "recipient", end_time: "end", time: "time",
  durationMin: "duration", priceCents: "price", target_name: "target", product_name: "product",
  source_date: "originalDate", source_time: "originalTime", end_date: "endDate", message_mode: "content",
  override_reason: "overrideReason", override_requested: "overrideConsent", destination_mode: "destination",
};
const labels: Record<string, string> = { service: "serviço", customer: "cliente", professional: "profissional",
  appointment: "agendamento", recipient: "destinatário", end: "horário final", time: "horário", date: "data",
  duration: "duração em minutos", price: "preço", target: "nome", name: "nome", phone: "telefone", email: "e-mail",
  product: "produto", quantity: "quantidade", mode: "entrada ou saída", period: "período", reason: "motivo",
  content: "texto da mensagem", channel: "canal", originalDate: "data original", originalTime: "horário original",
  endDate: "data final", selection: "opção", details: "informação que falta", overrideReason:"motivo do encaixe", overrideConsent:"decisão sobre o conflito", destination:"outro horário" };
const semantic = (field: string) => aliases[field] ?? (labels[field] ? field : "details");
const join = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
const linguistic = (action: PlanAction, key: string) => {
  const value = (action.fields as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};
const name = (action: PlanAction) => linguistic(action, "customer_name") ?? action.fields.communication?.recipient_name ?? action.fields.target_name ?? action.fields.name;
const when = (action: PlanAction) => (action.fields as Record<string, unknown>).day_offset === 1 ? " amanhã" : "";
const forPerson = (action: PlanAction) => name(action) ? ` para ${name(action)}${when(action)}` : when(action);

/** Skill-specific display dependencies; no resolution, field mutation or availability logic. */
function askFields(action: PlanAction, hint?: ClarificationHint): string[] {
  if (hint?.selection) return [semantic(hint.selection.field)];
  let fields = [...new Set((hint?.fields ?? action.missing_fields).map(semantic))];
  if (action.skill === "scheduling") {
    if (fields.includes("customer")) return ["customer"];
    if (fields.includes("appointment")) return ["appointment"];
    if (fields.includes("service")) fields = fields.filter(f => f !== "professional" && f !== "selection");
  }
  if (action.skill === "inventory" && fields.includes("product")) return ["product"];
  if (action.skill === "communication" && fields.includes("recipient")) return ["recipient"];
  return fields;
}
function question(action: PlanAction, fields: string[], hint?: ClarificationHint): string {
  if(hint?.question)return hint.question;
  if(fields.length===1&&fields[0]==="overrideReason")return "Qual o motivo do encaixe?";
  const pick = hint?.selection;
  if (pick) {
    const field = semantic(pick.field), who = name(action);
    const prompt = field === "customer" && who ? `Qual ${who} você quis dizer?` : `Qual ${labels[field] ?? "opção"} você deseja${field === "service" ? forPerson(action) : ""}?`;
    return `${prompt}${pick.labels.length ? `\n${pick.labels.map(label => `• ${label}`).join("\n")}` : ""}`;
  }
  if (fields.length === 1 && fields[0] === "service") return name(action) ? `Qual serviço ${name(action)} vai fazer?` : "Qual serviço você deseja?";
  if (action.operation === "schedule.block" && fields.includes("time") && fields.includes("end") && fields.length <= 3)
    return `De que horas até que horas devo bloquear a agenda${linguistic(action, "professional_name") ? ` de ${linguistic(action, "professional_name")}` : ""}${fields.includes("date") ? " e em qual dia" : ""}?`;
  if (fields.length === 1 && fields[0] === "end" && action.operation === "schedule.block")
    return `Até que horas devo bloquear a agenda${linguistic(action, "professional_name") ? ` de ${linguistic(action, "professional_name")}` : ""}?`;
  if (fields.includes("service") && fields.includes("time") && fields.length === 2)
    return `Qual serviço e horário você quer${forPerson(action)}?`;
  if (action.operation === "appointment.change" && fields.length <= 2 && fields.every(field => field === "date" || field === "time")) {
    const who = name(action) ? ` ${name(action)}` : " o agendamento";
    return fields.length === 2 ? `Para qual dia e horário devo passar${who}?` : fields[0] === "date" ? `Para qual dia devo passar${who}?` : `Para qual horário devo passar${who}?`;
  }
  if (fields.length === 1 && fields[0] === "time") return `Qual horário você quer${forPerson(action)}?`;
  // Agenda wording: ask the way a receptionist would, naming the role asked.
  if (fields.length === 1 && fields[0] === "reason" && action.operation === "appointment.cancel") return "Qual o motivo do cancelamento?";
  const booking = name(action) ? ` é o agendamento de ${name(action)}` : "";
  if (fields.length === 1 && fields[0] === "date") return action.operation === "schedule.block" ? "Para qual dia é o bloqueio?" : `Para qual dia${booking}?`;
  if (fields.length === 2 && fields.includes("date") && fields.includes("time") && action.skill === "scheduling") return `Para qual dia e horário${booking}?`;
  if (fields.length === 1 && fields[0] === "content") return "Qual texto devo usar na mensagem? Envie entre aspas ou peça uma sugestão.";
  if (fields.length === 1 && fields[0] === "period") return "Qual período você quer consultar?";
  if (fields.length === 1 && fields[0] === "mode") return "É uma entrada ou uma saída de estoque?";
  if (fields.length === 1 && fields[0] === "customer") return "Para qual cliente?";
  if (fields.length === 1 && fields[0] === "appointment") return action.operation === "appointment.cancel" ? "Qual agendamento você quer cancelar?" : "Qual agendamento você deseja alterar?";
  const subject = action.skill === "services" ? action.fields.target_name ?? action.fields.name : undefined;
  return `Pode informar ${join(fields.map(field => labels[field]))}${subject ? ` de ${subject}` : ""}?`;
}
export function conversationalClarifications(plan: ActionPlan, hints: PresentationHints = {}) {
  return plan.actions.filter(action => action.status !== "DONE" && action.missing_fields.length).map(action => {
    const hint = hints[action.key], fields = askFields(action, hint);
    return { action_key: action.key, fields, question: question(action, fields.length ? fields : ["details"], hint) };
  });
}
const operations: Record<string, string> = {
  "appointment.create": "Agendar", "appointment.cancel": "Cancelar agendamento", "appointment.change": "Remarcar agendamento",
  "appointment.list": "Consultar agenda", "appointment.read": "Consultar agendamento", "availability.get": "Consultar horários",
  "schedule.block": "Bloquear agenda", "service.create": "Cadastrar serviço", "service.change": "Alterar serviço",
  "customer.create": "Cadastrar cliente", "customer.change": "Alterar cliente", "customer.search": "Buscar cliente",
  "customer.read": "Consultar cliente", "customer.message": "Preparar mensagem", "financial.report": "Consultar faturamento",
  "product.search": "Consultar produtos", "stock.balance": "Consultar estoque", "stock.movement": "Movimentar estoque",
};
function title(action: PlanAction) {
  const subject = action.operation === "schedule.block" ? linguistic(action, "professional_name") : name(action) ?? action.fields.inventory?.product_name;
  return `${operations[action.operation] ?? "Revisar pedido"}${subject ? ` — ${subject}` : ""}`;
}
/** Translate protocol text only. Exact message content is separated before calling this. */
function readable(text: string) {
  const fields = /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b|\bdurationMin\b|\bpriceCents\b/g;
  // A backend timezone is a display value, not an internal field identifier.
  // Recognize complete IANA names before translating underscore-shaped tokens.
  return text.replace(/\b[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+\b|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b|\bdurationMin\b|\bpriceCents\b/g,
    word => {
      if (word.includes("/")) {
        try { new Intl.DateTimeFormat("pt-BR", { timeZone: word }); return word; }
        catch { /* Not a timezone: retain the normal technical-field treatment. */ }
      }
      return word.replace(fields, field => labels[semantic(field)] ?? "informação");
    });
}
function preview(action: PlanAction, protectedContents: readonly string[]) {
  const text = action.assessment.preview ?? "";
  // Atomic cancellation/message adapters can attach the full preview to the cancellation too.
  // Never rewrite, filter or deduplicate user-authored EXACT content within a shared preview.
  for (const content of protectedContents) {
    const at = text.indexOf(content);
    if (at >= 0) return readable(text.slice(0, at)) + text.slice(at);
  }
  return readable(text.split("\n").filter(line => !/^(?:Use Confirmar|Tudo será aplicado na mesma transação\.|A ação 2 depende|Dados da ação dependente|Leitura após )/.test(line))
    .map(line => line.replace(/ Tudo será aplicado na mesma transação\./g, "")).join("\n"));
}
export function composeActionPlanResponse(plan: ActionPlan, hints: PresentationHints = {}): string {
  // Two pending fields that ask the very same question are one question (C08).
  const questions = conversationalClarifications(plan, hints).filter((q, i, all) => all.findIndex(other => other.question === q.question) === i);
  const problems = plan.actions.filter(a => ["DOMAIN_CONFLICT", "BLOCKED_BY_DEPENDENCY", "UNSUPPORTED", "FAILED_SAFE"].includes(a.status));
  const problemLines = problems.map(a => `${title(a)}: ${a.status === "DOMAIN_CONFLICT" ? "há um conflito a revisar" : a.status === "BLOCKED_BY_DEPENDENCY" ? "aguarda a ação anterior" : "não foi possível preparar este item"}.`);
  if (questions.length) {
    // Missing items own all questions. Complete siblings' previews never become a second questionnaire.
    const ready = plan.actions.filter(a => !a.missing_fields.length && ["READY_FOR_CONFIRMATION", "DONE"].includes(a.status)).length;
    const intro = questions.length > 1 ? `${ready ? `${ready} ${ready === 1 ? "item já está preparado" : "itens já estão preparados"}. ` : ""}Só preciso ${questions.length === 2 ? "de duas informações" : `destas ${questions.length} informações`}:` : "";
    const notices = [...new Set(plan.actions.filter(a => a.missing_fields.length).map(a => hints[a.key]?.notice).filter((x): x is string => !!x))].map(readable);
    return [...problemLines, ...notices, intro, questions.length === 1 ? questions[0].question : questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")].filter(Boolean).join("\n\n");
  }
  const shown = new Set<string>(), parts: string[] = [...problemLines];
  const protectedContents = plan.actions.flatMap(a => a.fields.communication?.content ? [a.fields.communication.content] : []);
  for (const action of plan.actions) {
    if (problems.includes(action)) continue;
    const group = hints[action.key]?.previewGroup ?? (action.released_slot_of ? `slot:${action.released_slot_of}` : plan.actions.some(a => a.released_slot_of === action.key) ? `slot:${action.key}` : action.key);
    if (shown.has(group)) continue;
    shown.add(group);
    parts.push(preview(action, protectedContents) || `${title(action)}${action.status === "READY" ? ": aguardando a ação anterior" : ""}.`);
  }
  // A satisfied dependency (parent already DONE) is no longer a condition to announce.
  const edges = plan.dependencies.filter(edge => plan.actions.find(a => a.key === edge.from)?.status !== "DONE").map(edge => {
    const from = plan.actions.find(a => a.key === edge.from)!, to = plan.actions.find(a => a.key === edge.to)!;
    return `${title(to)} só poderá ocorrer após ${title(from).replace(/^./, c => c.toLocaleLowerCase("pt-BR"))}.`;
  });
  const groups = plan.confirmation_groups;
  const confirmation = groups.some(g => g.status === "SPECIAL_REVIEW") ? "Este conjunto precisa de uma revisão especial antes de confirmar." :
    plan.status === "READY_FOR_CONFIRMATION" ? plan.review === "SPLIT_REVIEW" ? `Confira os ${groups.length} grupos antes de confirmar cada um.` : "Confira os detalhes antes de confirmar." :
      problems.length ? "Os itens com pendências precisam ser revisados antes de confirmar." : "";
  return [...parts, ...edges, confirmation].filter(Boolean).join("\n\n");
}
