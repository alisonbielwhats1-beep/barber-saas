import type { ActionPlan, PlanAction } from "./action-plan";

/** Ephemeral display hints from an already resolved adapter. Never persisted in a plan. */
/** `selection.refs`: backend refs parallel to `labels` (option N = labels[N-1]); backend-only, never published. */
/** `waiting` (C5): the action only waits for another action's value (same_as); a note, never a question. */
/** `subject` (B7): the display name the backend resolved for the action's subject (e.g. "Fábio Santos" for "fabio"). */
export type ClarificationHint = { fields?: readonly string[]; question?: string; selection?: { field: string; labels: readonly string[]; refs?: readonly string[] };
  notice?: string; previewGroup?: string; waiting?: string; subject?: string };
export type PresentationHints = Readonly<Record<string, ClarificationHint>>;
const aliases: Record<string, string> = {
  service_ref: "service", service_name: "service", customer_ref: "customer", customer_name: "customer",
  customer_id: "customer", professional_ref: "professional", professional_name: "professional", professional_id: "professional",
  appointment_ref: "appointment", recipient_name: "recipient", end_time: "end", time: "time",
  durationMin: "duration", priceCents: "price", target_name: "target", product_name: "product",
  source_date: "originalDate", source_time: "originalTime", end_date: "endDate", message_mode: "content",
  override_reason: "overrideReason", override_requested: "overrideConsent", destination_mode: "destination",
  // P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT): the NEW professional and the service delta of an appointment.change.
  target_professional_name: "newProfessional", target_professional_ref: "newProfessional", service_changes: "newServices", service_changes_ref: "newServices",
  // P2b (flag SALON_SECRETARY_MULTI_SERVICE): the services of one new appointment (a list, its cards).
  service_names: "services", service_list_ref: "services", service_combo_ref: "services",
};
const labels: Record<string, string> = { service: "serviço", customer: "cliente", professional: "profissional",
  appointment: "agendamento", recipient: "destinatário", end: "horário final", time: "horário", date: "data",
  duration: "duração em minutos", price: "preço", target: "nome", name: "nome", phone: "telefone", email: "e-mail",
  product: "produto", quantity: "quantidade", mode: "entrada ou saída", period: "período", reason: "motivo",
  content: "texto da mensagem", channel: "canal", originalDate: "data original", originalTime: "horário original",
  endDate: "data final", selection: "opção", details: "informação que falta", overrideReason:"motivo do encaixe", overrideConsent:"decisão sobre o conflito", destination:"outro horário",
  newProfessional: "novo profissional", newServices: "serviço", services: "serviços" };
const semantic = (field: string) => aliases[field] ?? (labels[field] ? field : "details");
const join = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
const linguistic = (action: PlanAction, key: string) => {
  const value = (action.fields as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};
// B7: once the backend resolved the subject, sentences name it as registered ("Fábio Santos", not "fabio").
const name = (action: PlanAction, hint?: ClarificationHint) => (action.operation !== "schedule.block" ? hint?.subject : undefined) ??
  linguistic(action, "customer_name") ?? action.fields.communication?.recipient_name ?? action.fields.target_name ?? action.fields.name;
const professional = (action: PlanAction, hint?: ClarificationHint) => (action.operation === "schedule.block" ? hint?.subject : undefined) ?? linguistic(action, "professional_name");
const when = (action: PlanAction) => (action.fields as Record<string, unknown>).day_offset === 1 ? " amanhã" : "";
const forPerson = (action: PlanAction, hint?: ClarificationHint) => name(action, hint) ? ` para ${name(action, hint)}${when(action)}` : when(action);
/** UX-COPY (flag SALON_SECRETARY_COPY_V2, default off): questions name what the operation does with the time asked (an existing
 * appointment's own time, a block's start, where a move goes). Off, every question is the historical one. */
const copyV2 = () => process.env.SALON_SECRETARY_COPY_V2 === "true";
/** An existing appointment's own coordinates are asked (cancel/read), never a time to book. */
const locates = (action: PlanAction) => action.operation === "appointment.cancel" || action.operation === "appointment.read";
function operationQuestion(action: PlanAction, fields: string[], hint?: ClarificationHint): string | undefined {
  const of = name(action, hint) ? ` de ${name(action, hint)}` : "";
  if (fields.length === 1 && fields[0] === "time" && locates(action)) return `Qual é o horário do agendamento${of}?`;
  if (fields.length === 1 && fields[0] === "time" && action.operation === "schedule.block")
    return `A partir de que horas devo bloquear a agenda${professional(action, hint) ? ` de ${professional(action, hint)}` : ""}?`;
  // A move's origin is the appointment as it is booked now ("data original" read as a wish).
  const origin = fields.every(field => field === "originalDate" || field === "originalTime");
  if (action.operation === "appointment.change" && origin && fields.length === 2) return `Em que dia e horário está marcado o agendamento${of}?`;
  if (action.operation === "appointment.change" && origin && fields[0] === "originalDate") return `Em que dia está marcado o agendamento${of}?`;
  if (action.operation === "appointment.change" && origin && fields[0] === "originalTime") return `Qual é o horário atual do agendamento${of}?`;
  return undefined;
}

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
    const field = semantic(pick.field), who = name(action, hint);
    const prompt = field === "customer" && who ? `Qual ${who} você quis dizer?` : `Qual ${labels[field] ?? "opção"} você deseja${field === "service" ? forPerson(action, hint) : ""}?`;
    return `${prompt}${pick.labels.length ? `\n${pick.labels.map(label => `• ${label}`).join("\n")}` : ""}`;
  }
  // An existing appointment is identified by its service; a new one chooses it.
  if (fields.length === 1 && fields[0] === "service") return ["appointment.change", "appointment.cancel", "appointment.read", "appointment.list"].includes(action.operation)
    ? `Qual é o serviço do agendamento${name(action, hint) ? ` de ${name(action, hint)}` : ""}?` : name(action, hint) ? `Qual serviço ${name(action, hint)} vai fazer?` : "Qual serviço você deseja?";
  if (action.operation === "schedule.block" && fields.includes("time") && fields.includes("end") && fields.length <= 3)
    return `De que horas até que horas devo bloquear a agenda${professional(action, hint) ? ` de ${professional(action, hint)}` : ""}${fields.includes("date") ? " e em qual dia" : ""}?`;
  if (fields.length === 1 && fields[0] === "end" && action.operation === "schedule.block")
    return `Até que horas devo bloquear a agenda${professional(action, hint) ? ` de ${professional(action, hint)}` : ""}?`;
  if (fields.includes("service") && fields.includes("time") && fields.length === 2)
    return `Qual serviço e horário você quer${forPerson(action, hint)}?`;
  const byOperation = copyV2() && fields.length ? operationQuestion(action, fields, hint) : undefined;
  if (byOperation) return byOperation;
  if (action.operation === "appointment.change" && fields.length <= 2 && fields.every(field => field === "date" || field === "time")) {
    const who = name(action, hint) ? ` ${name(action, hint)}` : " o agendamento";
    return fields.length === 2 ? `Para qual dia e horário devo passar${who}?` : fields[0] === "date" ? `Para qual dia devo passar${who}?` : `Para qual horário devo passar${who}?`;
  }
  if (fields.length === 1 && fields[0] === "time") return `Qual horário você quer${forPerson(action, hint)}?`;
  // Agenda wording: ask the way a receptionist would, naming the role asked.
  if (fields.length === 1 && fields[0] === "reason" && action.operation === "appointment.cancel") return "Qual o motivo do cancelamento?";
  const booking = name(action, hint) ? ` é o agendamento de ${name(action, hint)}` : "";
  if (fields.length === 1 && fields[0] === "date") return action.operation === "schedule.block" ? "Para qual dia é o bloqueio?" : `Para qual dia${booking}?`;
  if (fields.length === 2 && fields.includes("date") && fields.includes("time") && action.skill === "scheduling") return `Para qual dia e horário${booking}?`;
  if (fields.length === 1 && fields[0] === "content") return "Qual texto devo usar na mensagem? Envie entre aspas ou peça uma sugestão.";
  if (fields.length === 1 && fields[0] === "period") return "Qual período você quer consultar?";
  if (fields.length === 1 && fields[0] === "mode") return "É uma entrada ou uma saída de estoque?";
  if (fields.length === 1 && fields[0] === "customer") return "Para qual cliente?";
  if (fields.length === 1 && fields[0] === "appointment") return action.operation === "appointment.cancel" ? "Qual agendamento você quer cancelar?" : "Qual agendamento você deseja alterar?";
  const subject = action.skill === "services" ? hint?.subject ?? action.fields.target_name ?? action.fields.name : undefined;
  return `Pode informar ${join(fields.map(field => labels[field]))}${subject ? ` de ${subject}` : ""}?`;
}
export function conversationalClarifications(plan: ActionPlan, hints: PresentationHints = {}) {
  return plan.actions.filter(action => action.status !== "DONE" && action.status !== "DISCARDED" && action.missing_fields.length && !hints[action.key]?.waiting).map(action => {
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
/** P2a: a change that alters who attends or the services is an alteration, not only a new time (data-driven: flag off,
 * these fields never exist). */
const alters = (action: PlanAction) => action.operation === "appointment.change" && ((action.fields as Record<string, unknown>).target_professional_name != null || (action.fields as Record<string, unknown>).service_changes != null);
function title(action: PlanAction, hint?: ClarificationHint) {
  const subject = action.operation === "schedule.block" ? professional(action, hint) : name(action, hint) ?? action.fields.inventory?.product_name;
  return `${alters(action) ? "Alterar agendamento" : operations[action.operation] ?? "Revisar pedido"}${subject ? ` — ${subject}` : ""}`;
}
/** Noun phrase of a confirmable write ("remarcação de Fábio", "bloqueio de Rodrigo"). */
const confirmations: Record<string, [string, string]> = {
  "appointment.create": ["agendamento", " de "], "appointment.change": ["remarcação", " de "], "appointment.cancel": ["cancelamento", " de "],
  "schedule.block": ["bloqueio", " de "], "service.create": ["cadastro do serviço", " "], "service.change": ["alteração do serviço", " "],
  "customer.create": ["cadastro", " de "], "customer.change": ["alteração do cadastro", " de "], "customer.message": ["mensagem", " para "],
  "stock.movement": ["movimentação de estoque", " de "],
};
function confirmationItem(action: PlanAction, hint?: ClarificationHint) {
  const [noun, link] = alters(action) ? ["alteração do agendamento", " de "] as const : confirmations[action.operation] ?? [(operations[action.operation] ?? "ação").toLocaleLowerCase("pt-BR"), " — "];
  const subject = action.operation === "schedule.block" ? professional(action, hint) : name(action, hint) ?? action.fields.inventory?.product_name;
  return `${noun}${subject ? `${link}${subject}` : ""}`;
}
const articles: Record<string, string> = { "appointment.create": "o", "appointment.change": "a", "appointment.cancel": "o", "schedule.block": "o",
  "service.create": "o", "service.change": "a", "customer.create": "o", "customer.change": "a", "customer.message": "a", "stock.movement": "a" };
const readItems: Record<string, string> = { "appointment.list": "a consulta da agenda", "appointment.read": "a consulta do agendamento",
  "availability.get": "a consulta de horários", "customer.search": "a busca de cliente", "customer.read": "a consulta de cliente",
  "financial.report": "a consulta financeira", "product.search": "a busca de produto", "stock.balance": "a consulta de estoque" };
/** `hint` (UX-COPY): the subject as registered once resolved (B7); without it, the owner's words as before. */
const discardedItem = (action: PlanAction, hint?: ClarificationHint) => articles[action.operation] ? `${articles[action.operation]} ${confirmationItem(action, hint)}` : readItems[action.operation] ?? "o item";
/** DISCARD notice: the actions the owner gave up, then those that went with them (atomic unit or
 * dependents). Always states that nothing was executed. */
export function discardNotice(requested: readonly PlanAction[], closed: readonly PlanAction[] = [], hints: PresentationHints = {}) {
  const item = (action: PlanAction) => discardedItem(action, hints[action.key]);
  const also = closed.length ? ` Também descartei ${join(closed.map(item))}, que ${closed.length === 1 ? "estava ligado" : "estavam ligados"} a ${requested.length === 1 ? "esse item" : "esses itens"}.` : "";
  return `Certo, descartei ${join(requested.map(item))}.${also} Nada foi alterado.`;
}
/** B5: one part of the owner's message left out of a partially accepted turn. `quote`: the owner's own
 * words for it (its clause, verified in the message); `action`: the existing plan action a left-out
 * correction targeted; otherwise the operation and the name it carried. */
export type RejectedPart = { dependent: boolean; quote?: string; action?: PlanAction; operation?: string | null; subject?: string | null };
function rejectedItem(part: RejectedPart, hints: PresentationHints = {}) {
  if (part.quote) return `“${part.quote}”`;
  if (part.action) return discardedItem(part.action, hints[part.action.key]);
  const operation = part.operation ?? "", confirmation = confirmations[operation];
  if (articles[operation] && confirmation) return `${articles[operation]} ${confirmation[0]}${part.subject ? `${confirmation[1]}${part.subject}` : ""}`;
  return readItems[operation] ?? "um dos pedidos";
}
/** Never silent: says which parts were not understood (and what depended on them), that they were left
 * out, and asks to repeat them. Nothing of those parts was prepared or changed. A left-out correction of an
 * action already in the plan (`action`) is said as a change NOT applied: that action stays as it was and is
 * held for review (its proposal withdrawn by the backend), never "left out" while still confirmable. */
/** `hints` (UX-COPY): screen only (this notice is never Luna's context); without them, the owner's words as before. */
export function rejectedPartsNotice(parts: readonly RejectedPart[], hints: PresentationHints = {}) {
  const item = (part: RejectedPart) => rejectedItem(part, hints);
  const corrections = parts.filter(part => part.action), rest = parts.filter(part => !part.action);
  const main = rest.filter(part => !part.dependent), also = rest.filter(part => part.dependent), one = main.length === 1;
  const sentences: string[] = [];
  if (main.length) sentences.push(`Não entendi com segurança ${one ? "esta parte do pedido e a deixei" : "estas partes do pedido e as deixei"} de fora: ${join(main.map(item))}.` +
    (also.length ? ` Também deixei de fora ${join(also.map(item))}, que ${also.length === 1 ? "dependia" : "dependiam"} ${one ? "dela" : "delas"}.` : ""));
  if (corrections.length) sentences.push(`Não apliquei a alteração que você pediu para ${join(corrections.map(part => `${discardedItem(part.action!, hints[part.action!.key])}${part.quote ? ` (“${part.quote}”)` : ""}`))}; ` +
    `${corrections.length === 1 ? "esse item continua como estava e precisa ser revisto" : "esses itens continuam como estavam e precisam ser revistos"} antes de confirmar.`);
  if (!sentences.length) return "";
  return `${sentences.join(" ")} Pode repetir ${main.length + also.length + corrections.length === 1 ? "essa parte" : "essas partes"} de outro jeito?`;
}
/** Review 2b: preview of an action whose requested change was not applied (or whose answer was not read): its
 * proposal was withdrawn, its accepted data kept; it is prepared again only after the owner restates or keeps it. */
export const reviewRequiredMessage = "A alteração pedida para esta ação não foi aplicada. Os dados anteriores foram preservados; repita a alteração ou diga que mantém como estava para preparar uma nova proposta.";
/** B3 (review 2b): a discard that would also close linked actions (its atomic partner or dependents) is asked
 * first; nothing changes until the owner confirms the whole set. */
/** `hints` (UX-COPY): only for the text shown on screen; the question kept for Luna is built without them (B7). */
export function discardQuestion(requested: readonly PlanAction[], linked: readonly PlanAction[], hints: PresentationHints = {}) {
  const total = requested.length + linked.length, item = (action: PlanAction) => discardedItem(action, hints[action.key]);
  return `Descartar ${join(requested.map(item))} também descarta ${join(linked.map(item))}, que ${linked.length === 1 ? "está ligado" : "estão ligados"} a ${requested.length === 1 ? "esse item" : "esses itens"}. ` +
    `Quer que eu descarte ${total === 2 ? "os dois" : `os ${total}`}? Nada foi alterado.`;
}
const referenceLabels: Record<string, string> = { date: "o dia", time: "o horário", professional: "o profissional", customer: "o cliente", service: "o serviço" };
const referenceLabel = (fields: readonly string[]) => join(fields.map(field => referenceLabels[field] ?? "o dado"));
const ofItem = (action: PlanAction) => discardedItem(action).replace(/^o /, "do ").replace(/^a /, "da ");
/** C5: an action whose field follows another action's value that is not known yet: a note naming what it waits for
 * ("Agendar — Rosa: aguardando o dia do agendamento de Carla."), never a question to the owner. */
export function referenceWaitingNote(action: PlanAction, waits: readonly { fields: readonly string[]; referenced: PlanAction }[]) {
  return `${title(action)}: aguardando ${join(waits.map(({ fields, referenced }) => `${referenceLabel(fields)} ${ofItem(referenced)}`))}.`;
}
/** C5: the owner stated a value AND a reference to another action's value that disagree: none is chosen, it is asked. */
export const referenceConflictNotice = (fields: readonly string[]) => `Recebi indicações diferentes para ${referenceLabel(fields)} e não escolhi nenhuma.`;
/** Writes of groups the backend already marked confirmable, announced once as a statement (never a question). */
function confirmableLead(plan: ActionPlan, hints: PresentationHints = {}) {
  const ready = new Set((plan.confirmation_groups ?? []).filter(group => group.status === "READY_FOR_CONFIRMATION").flatMap(group => group.action_keys));
  const items = plan.actions.filter(action => ready.has(action.key) && action.mutation && action.status === "READY_FOR_CONFIRMATION").map(action => confirmationItem(action, hints[action.key]));
  return !items.length ? "" : items.length > 3 ? `Já dá para confirmar ${items.length} itens.` : `Já dá para confirmar: ${join(items)}.`;
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
  return readable(text.split("\n").filter(line => !/^(?:Use Confirmar|Tudo será aplicado na mesma transação\.|A ação 2 depende|Dados da ação dependente|Leitura após |Esta consulta será feita depois )/.test(line))
    .map(line => line.replace(/ Tudo será aplicado na mesma transação\./g, "")).join("\n"));
}
export function composeActionPlanResponse(plan: ActionPlan, hints: PresentationHints = {}): string {
  // Two pending fields that ask the very same question are one question (C08).
  const questions = conversationalClarifications(plan, hints).filter((q, i, all) => all.findIndex(other => other.question === q.question) === i);
  const problems = plan.actions.filter(a => ["DOMAIN_CONFLICT", "BLOCKED_BY_DEPENDENCY", "UNSUPPORTED", "FAILED_SAFE"].includes(a.status));
  const problemLines = problems.map(a => `${title(a, hints[a.key])}: ${a.status === "DOMAIN_CONFLICT" ? "há um conflito a revisar" : a.status === "BLOCKED_BY_DEPENDENCY" ? "aguarda a ação anterior" : "não foi possível preparar este item"}.`);
  if (questions.length) {
    // Missing items own all questions. Complete siblings' previews never become a second questionnaire.
    const ready = plan.actions.filter(a => !a.missing_fields.length && ["READY_FOR_CONFIRMATION", "DONE"].includes(a.status)).length;
    const lead = confirmableLead(plan, hints);
    const intro = questions.length > 1 ? `${ready && !lead ? `${ready} ${ready === 1 ? "item já está preparado" : "itens já estão preparados"}. ` : ""}Só preciso ${questions.length === 2 ? "de duas informações" : `destas ${questions.length} informações`}:` : "";
    const notices = [...new Set(plan.actions.filter(a => a.missing_fields.length).map(a => hints[a.key]?.notice).filter((x): x is string => !!x))].map(readable);
    // C5: an action that only waits for another action's value is a note after the questions, never one of them.
    const waiting = plan.actions.filter(a => a.missing_fields.length && hints[a.key]?.waiting).map(a => hints[a.key]!.waiting!);
    // A single natural question (validated conversational UX). The cards show each action's
    // details; the lead only names what can already be confirmed on its own.
    return [...problemLines, lead, ...notices, intro, questions.length === 1 ? questions[0].question : questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n"), ...waiting].filter(Boolean).join("\n\n");
  }
  const shown = new Set<string>(), parts: string[] = [...problemLines];
  const protectedContents = plan.actions.flatMap(a => a.fields.communication?.content ? [a.fields.communication.content] : []);
  for (const action of plan.actions) {
    if (problems.includes(action) || action.status === "DISCARDED") continue;
    const group = hints[action.key]?.previewGroup ?? (action.released_slot_of ? `slot:${action.released_slot_of}` : plan.actions.some(a => a.released_slot_of === action.key) ? `slot:${action.key}` : action.key);
    if (shown.has(group)) continue;
    shown.add(group);
    parts.push(preview(action, protectedContents) || `${title(action, hints[action.key])}${action.status === "READY" ? ": aguardando a ação anterior" : ""}.`);
  }
  // A satisfied dependency (parent already DONE) is no longer a condition to announce.
  const edges = plan.dependencies.filter(edge => plan.actions.find(a => a.key === edge.from)?.status !== "DONE" &&
    ![edge.from, edge.to].some(key => plan.actions.find(a => a.key === key)?.status === "DISCARDED")).map(edge => {
    const from = plan.actions.find(a => a.key === edge.from)!, to = plan.actions.find(a => a.key === edge.to)!;
    return `${title(to, hints[to.key])} só poderá ocorrer após ${title(from, hints[from.key]).replace(/^./, c => c.toLocaleLowerCase("pt-BR"))}.`;
  });
  const groups = plan.confirmation_groups;
  const confirmation = groups.some(g => g.status === "SPECIAL_REVIEW") ? "Este conjunto precisa de uma revisão especial antes de confirmar." :
    plan.status === "READY_FOR_CONFIRMATION" ? plan.review === "SPLIT_REVIEW" ? `Confira os ${groups.length} grupos antes de confirmar cada um.` : "Confira os detalhes antes de confirmar." :
      [confirmableLead(plan, hints), problems.length ? "Os itens com pendências precisam ser revisados antes de confirmar." : ""].filter(Boolean).join(" ");
  return [...parts, ...edges, confirmation].filter(Boolean).join("\n\n");
}
