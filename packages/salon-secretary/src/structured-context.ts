/** B7 structured clarification context: what was asked as a code plus a short, stable sentence (no names, dates or
 * screen prose). The backend publishes it with SALON_SECRETARY_STRUCTURED_CONTEXT (src/lib/secretary-clarification.ts);
 * the request budget (index.ts) converts an already built prose context into exactly the same form when a request would
 * not fit the cap. One source for both, so the degraded request says what the flag-on context says. */
export type QuestionCode = "OPTION" | "CALENDAR" | "DAYPART" | "FIELD" | "FIELDS";
const askedLabels: Record<string, string> = {date:"o dia",time:"o horário",source_date:"o dia original",source_time:"o horário original",end_date:"o dia final",end_time:"o horário final",
  reason:"o motivo",override_reason:"o motivo do encaixe",override_requested:"a decisão sobre o conflito",destination_mode:"outro horário",customer_name:"o cliente",customer_ref:"o cliente",
  service_name:"o serviço",service_ref:"o serviço",professional_name:"o profissional",professional_ref:"o profissional",appointment_ref:"o agendamento",recipient_name:"o destinatário",
  channel:"o canal",content:"o texto da mensagem",message_mode:"o texto da mensagem",target_name:"o nome",name:"o nome",phone:"o telefone",email:"o e-mail",durationMin:"a duração",
  priceCents:"o preço",product_name:"o produto",quantity:"a quantidade",mode:"entrada ou saída",period:"o período",selection:"uma opção"};
const asked = (field: string) => askedLabels[field] ?? "a informação que falta";
const joined = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
/** The short stable sentence published as previous_response under the flag ("" when nothing is asked). */
export function structuredResponse(code: QuestionCode | undefined, requested: string | null, missing: readonly string[]) {
  if (!code) return "";
  if (code === "OPTION") return "Pedi uma das opções.";
  if (code === "CALENDAR") return "Pedi qual data vale.";
  if (code === "DAYPART") return "Pedi manhã ou tarde.";
  return `Pedi ${code === "FIELD" && requested ? asked(requested) : joined([...new Set(missing.map(asked))])}.`;
}
type Clarification = { missing_fields?: unknown; requested_component?: unknown; requested_field?: unknown; question_code?: unknown; previous_response?: unknown; candidates?: unknown } & Record<string, unknown>;
const isProse = (value: unknown): value is Clarification => !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as Clarification).previous_response === "string" &&
  Array.isArray((value as Clarification).missing_fields) && !Object.hasOwn(value, "question_code");
/** A published prose clarification in the flag-on form: the code follows from what the object itself says (an option
 * card, the calendar or daypart component, one requested field, several missing ones), in the same key order. */
export function structuredClarification(clarification: Clarification): Clarification {
  const missing = (clarification.missing_fields as unknown[]).filter((field): field is string => typeof field === "string");
  const requested = typeof clarification.requested_field === "string" ? clarification.requested_field : null;
  const code: QuestionCode | undefined = Object.hasOwn(clarification, "candidates") ? "OPTION" : clarification.requested_component === "calendar_reference" ? "CALENDAR"
    : clarification.requested_component === "daypart" ? "DAYPART" : requested ? "FIELD" : missing.length ? "FIELDS" : undefined;
  const out: Clarification = {};
  for (const [key, value] of Object.entries(clarification)) {
    if (key === "previous_response") { if (code) out.question_code = code; out.previous_response = structuredResponse(code, requested, missing); }
    else out[key] = value;
  }
  return out;
}
/** Every prose clarification inside `value` (a routing context, an adapter draft) in the structured form; everything
 * else untouched. Returns the same object when nothing changes. */
export function structuredContextData<T>(value: T): T {
  let changed = false;
  const walk = (item: unknown, key = ""): unknown => {
    if (key === "clarification" && isProse(item)) {
      // Nothing asked is already the structured form ("" and no code): converting it would change nothing.
      const next = structuredClarification(item);
      if (next.previous_response === item.previous_response && !Object.hasOwn(next, "question_code")) return item;
      changed = true; return next;
    }
    if (Array.isArray(item)) return item.map(entry => walk(entry));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, walk(v, k)]));
    return item;
  };
  const out = walk(value);
  return changed ? out as T : value;
}
