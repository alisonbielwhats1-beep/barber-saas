import { z } from "zod";
import { entityExtractionInstructions } from "./entity-extraction";

export const schedulingOperationIds = ["appointment.create", "appointment.list", "appointment.read", "availability.get", "appointment.change", "appointment.cancel", "schedule.block"] as const;
export const schedulingOperation = z.enum(schedulingOperationIds);
/** Per-turn linguistic evidence. Never a domain field or backend authority. */
export const temporalEvidence = z.array(z.object({
  field: z.enum(["date", "source_date", "end_date", "time", "source_time", "end_time"]),
  text: z.string().min(1).max(600),
}).strict()).max(6);
export type SchedulingTemporalEvidence = z.infer<typeof temporalEvidence>;
/** Private compatibility schema for preserved provider arguments. Never published. */
export const temporalEvidenceRoles = ["date", "source_date", "end_date", "time", "source_time", "end_time"] as const;
export const temporalEvidenceWire = z.object(Object.fromEntries(temporalEvidenceRoles.map(role =>
  [role, z.string().min(1).max(600).nullable()])) as Record<typeof temporalEvidenceRoles[number], z.ZodNullable<z.ZodString>>).strict();
export const temporalValueRoles = {
  date:'date',day_offset:'date',weekday:'date',time:'time',
  source_date:'source_date',source_day_offset:'source_date',source_weekday:'source_date',source_time:'source_time',
  end_date:'end_date',end_time:'end_time',
} as const;
export type TemporalValueField = keyof typeof temporalValueRoles;
/** A selector cannot be emitted without its own literal witness. */
export function temporalValueWire(field:TemporalValueField) {
  return z.object({value:schedulingFields[field],literal:z.string().min(1).max(600).regex(/\S/)}).strict().nullable();
}

/** One calendar reference split by the model into an explicit date and its weekday
 * ("terça, dia 14 de abril de 2027") is rejoined only when both quotes are exact,
 * unique and contiguous in the current message (separated by spaces, commas, an
 * opening parenthesis or "dia"), or one contains the other. The result is the exact
 * message span; the backend still compares the date with the stated weekday. */
function contiguousCalendarSpan(message: string, a: string, b: string): string | undefined {
  const at = (quote: string) => { const first = message.indexOf(quote); return first >= 0 && message.indexOf(quote, first + 1) < 0 ? first : -1; };
  const [x, y] = [at(a), at(b)];
  if (x < 0 || y < 0) return undefined;
  const [first, second] = x <= y ? [{ at: x, end: x + a.length }, { at: y, end: y + b.length }] : [{ at: y, end: y + b.length }, { at: x, end: x + a.length }];
  if (second.end <= first.end) return message.slice(first.at, first.end);
  if (second.at < first.end || /^[\s,(]*(?:dia\s+)?$/i.test(message.slice(first.end, second.at))) return message.slice(first.at, second.end);
  return undefined;
}
const calendarPair = (a: TemporalValueField, b: TemporalValueField) =>
  [a, b].includes("date") && [a, b].includes("weekday") || [a, b].includes("source_date") && [a, b].includes("source_weekday");

/** Structural decoding only. Never reassign a quote, inspect Portuguese, fill a
 * missing semantic value or mutate the provider's original argument object. */
export function decodeTemporalEvidencePayload(input: unknown, strictWire = false, message?: string): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const output = { ...input } as Record<string, unknown>;
  const selectors=Object.keys(temporalValueRoles) as TemporalValueField[];
  const coupled=selectors.some(field=>output[field]!=null&&typeof output[field]==='object');
  if(strictWire||coupled){
    if(Object.hasOwn(output,'temporal_evidence'))throw Error('TEMPORAL_EVIDENCE_WIRE_REQUIRED');
    const evidence:SchedulingTemporalEvidence=[],selectorOf=new Map<string,TemporalValueField>();
    for(const field of selectors){
      if(output[field]==null)continue;
      if(typeof output[field]!=='object')throw Error('TEMPORAL_VALUE_WIRE_REQUIRED');
      const witness=temporalValueWire(field).unwrap().parse(output[field]);
      const role=temporalValueRoles[field];
      // A new transport carries one selector per role. Conflicting or redundant
      // selectors cannot silently overwrite one another's proof.
      const existing=evidence.find(entry=>entry.field===role);
      // The same exact literal may witness two redundant selectors of one role
      // (date + day_offset for "depois de amanhã"); the backend still requires the
      // values to resolve to one date. Different literals are merged only for an
      // explicit date and its weekday that form one contiguous message span.
      if(existing&&existing.text!==witness.literal){
        const previous=selectorOf.get(role)!;
        const span=message!==undefined&&calendarPair(previous,field)?contiguousCalendarSpan(message,existing.text,witness.literal):undefined;
        if(!span)throw Error('TEMPORAL_SELECTOR_CONFLICT');
        const [dateField,weekdayField]=field.endsWith('weekday')?[previous,field]:[field,previous];
        if(dateField===field)output[field]=witness.value;
        output[weekdayField]=null;existing.text=span;selectorOf.set(role,dateField);
        continue;
      }
      output[field]=witness.value;if(!existing){evidence.push({field:role,text:witness.literal});selectorOf.set(role,field);}
    }
    if(evidence.length)output.temporal_evidence=temporalEvidenceRoles.flatMap(role=>evidence.filter(entry=>entry.field===role));
  }else if (output.temporal_evidence != null) {
    if (Array.isArray(output.temporal_evidence)) {
      // Immutable legacy arguments retain the original validator and fail-closed guard.
    } else {
      const proof = temporalEvidenceWire.parse(output.temporal_evidence);
      output.temporal_evidence = temporalEvidenceRoles.flatMap(field => proof[field] === null ? [] : [{ field, text: proof[field] }]);
    }
  }
  // Only transport-owned containers are traversed, never business text or arbitrary data.
  for (const key of ["turn", "fields", "new_request", "resume_request", "patches"]) {
    if (output[key] != null) output[key] = decodeTemporalEvidencePayload(output[key], strictWire, message);
  }
  if (Array.isArray(output.operations)) output.operations = output.operations.map(value => decodeTemporalEvidencePayload(value, strictWire, message));
  return output;
}
export const temporalEvidenceInstructions = `Cada campo temporal usa null (ausente) ou {value,literal}: value segue o tipo publicado; literal é a expressão ATUAL completa que comprova esse mesmo campo. Ex.: weekday={value:2,literal:"terça"}. Escolha só um seletor de data por papel. source_* identifica origem; date/day_offset/weekday/time, destino; end_*, fim. Separe por ação e papel mesmo se destino vier primeiro.
Inclua todos os qualificadores: "depois de amanhã", "duas da tarde", dia da semana e data quando juntos. Copie literal EXATAMENTE da mensagem atual, preservando idioma, acentos e maiúsculas. Nunca traduza, parafraseie, recorte, copie turnos anteriores ou cite a frase inteira. Um hoje discursivo não é a data do atendimento. Campos herdados ficam null.
period é filtro separado morning/afternoon/evening; período sozinho não fornece data nem relógio. Exceção: pending_temporal_ambiguities com clarification.requested_component=daypart permite selecionar somente um candidato publicado de requested_field. Nesse horário retorne {value:candidato,literal:período atual}, sem repetir campos aceitos. A prova não autoriza execução.
pending_calendar_conflicts com requested_component=calendar_reference: escolha somente calendar_date ou stated_weekday publicados para requested_field, usando o seletor correspondente e a resposta atual completa como literal. Não repita ambos nem invente outra data; os demais campos aceitos permanecem.`;
export const schedulingFields = {
  temporal_evidence: temporalEvidence.describe("Trechos literais da mensagem atual para comprovar cada data/horário novo por papel. Não é campo do ERP. " + temporalEvidenceInstructions),
  destination_mode: z.enum(["SAME_RELEASED_SLOT", "ALTERNATIVE_SLOT"]).describe("Somente appointment.create dependente: ALTERNATIVE_SLOT quando usuário escolhe outro horário; preserve a dependência e released_slot_of. Não invente horário."),
  override_requested: z.boolean().describe("Somente appointment.create: intenção explícita de encaixe, nunca confirmação operacional nem permissão. 'sim' isolado não autoriza encaixe."),
  override_reason: z.string().trim().min(1).max(200).describe("Somente appointment.create: motivo real explicitamente fornecido para encaixe. Trecho literal contínuo da mensagem atual, incluindo pronome e negação. Nunca parafraseie ou expanda sujeito. 'Pode encaixar' não é motivo. Ausente se não fornecido."),
  customer_name: z.string().trim().min(2).max(200).describe("Nome completo do cliente mencionado; não repartir sobrenomes/qualificadores em outros campos."),
  service_name: z.string().trim().min(2).max(200).describe("Serviço explicitamente mencionado como serviço, não fragmento do nome do cliente. Ausente/null se não informado."),
  professional_name: z.string().trim().min(2).max(200).describe("Profissional explicitamente mencionado nesse papel; ausente/null se não informado."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day_offset: z.number().int().min(0).max(365),
  weekday: z.number().int().min(0).max(6).describe("Dia do DESTINO em appointment.change; dia do atendimento em create/read/list/cancel/availability. Calendário 0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado. Não usar segunda como zero."),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  period: z.enum(["morning", "afternoon", "evening"]),
  source_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_day_offset: z.number().int().min(0).max(365),
  source_weekday: z.number().int().min(0).max(6).describe("Dia da ORIGEM do atendimento que será remarcado. Calendário 0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado. Não usar segunda como zero."),
  source_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(200).describe("Motivo real como trecho literal contínuo da mensagem atual, sem paráfrase, troca de sujeito ou remoção de negação. Ausente se não informado."),
};
export const schedulingInterpretation = z.object({ operation: schedulingOperation.nullable(),
  ...Object.fromEntries(Object.entries(schedulingFields).map(([k,v])=>[k,v.nullable().optional()])),
}).strict();
export type SchedulingInterpretation = { operation?: z.infer<typeof schedulingOperation> } & Partial<{
  temporal_evidence: SchedulingTemporalEvidence;
  destination_mode: "SAME_RELEASED_SLOT" | "ALTERNATIVE_SLOT"; override_requested: boolean; override_reason: string;
  customer_name: string; service_name: string; professional_name: string; date: string;
  day_offset: number; weekday: number; time: string; period: "morning" | "afternoon" | "evening";
  source_date: string; source_day_offset: number; source_weekday: number; source_time: string;
  end_time: string; end_date: string; reason: string;
}>;
export const batchInterpretation=z.object({item_key:z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  ...Object.fromEntries(Object.entries(schedulingFields).map(([k,v])=>[k,v.nullable().optional()])),
}).strict();
export type BatchInterpretation=Omit<SchedulingInterpretation,"operation"> & {item_key:string};
export const schedulingSkill = `Você é a única Secretária Everflair, agora com a capacidade Scheduling Core.
${entityExtractionInstructions}
${temporalEvidenceInstructions}
Interprete appointment.create/list/read/change/cancel, availability.get e schedule.block. Não alterar expediente nem desbloquear.
T21: cancelamento seguido de criação all_or_nothing; nunca execute item isolado. Destino padrão é horário liberado. ALTERNATIVE_SLOT escolhido explicitamente preserva dependência. Use chaves locais, nunca refs reais; não copie serviço/profissional do cancelamento. Continuação de batch usa item_key publicado e só campos novos da ação.
T13 remarca somente data/hora; preserva serviço/profissional. source_* localiza origem; date/day_offset/weekday/time, destino. Em "de amanhã às 10 para 11", origem amanhã 10h, destino 11h; backend herda data da origem se só a nova hora foi dita.
T14: date/time localizam reserva; motivo real obrigatório, nunca inventado. T15: date/time início, end_time fim, end_date só explícito; motivo opcional, bloquear não cancela reservas.
Cliente com conta pode ficar PENDING_ACCEPTANCE: não anuncie aceite/confirmado se o recibo aguarda aceite.
Nomes só explícitos: customer_name/service_name/professional_name. Nunca IDs/refs, preço, duração, fim calculado ou disponibilidade. Backend T01/T03/T04 resolve entidades; homônimos exigem seleção, ausência não cria entidade. Não envie listas de clientes ao modelo. Profissional ausente: backend resolve único elegível; vários exigem escolha.
date.value YYYY-MM-DD; day_offset hoje=0/amanhã=1; weekday terça=2; exatamente um seletor por papel. Backend congela data absoluta no fuso do salão. Hora inequívoca: time.value HH:mm; manhã/depois do almoço: period morning/afternoon, sem inventar hora. Data/ano ausente ou ambiguidade: omita e pergunte.
clarification publica missing_fields/requested_field/previous_response. Resposta curta atende requested_field; source_time não é destino. Retorne só patch novo/corrigido, preservando operação e campos aceitos; nunca reinicie nem copie o draft. Várias pendências sem papel claro: não adivinhe. Correção explícita pode mudar outro campo, preservando o papel.
T05/T06 leem agenda autorizada, T07 calcula vagas, T12 prepara READY, U02/U03 validam faltantes. Executar exige confirmação autenticada sem modelo. Conflito/estado alterado exige nova escolha; sucesso só com recibo. FROM significa a partir de; não prometer preço final nem exceção de jornada.
T21 V2: "outro horário" no create usa destination_mode=ALTERNATIVE_SLOT, override_requested=false; preserve cancelamento/chaves/dependências. Data/hora só explícitas; vagas pelo backend.
Encaixe: override_requested=true só com pedido explícito; "sim" isolado não basta. override_reason só motivo informado; omita se ausente, autorização não é motivo. Resposta ao motivo pendente preenche override_reason, não motivo do cancelamento. Backend decide permissão/elegibilidade/duração/conflitos; autorização de encaixe não confirma execução.
Sem ferramentas hospedadas, SQL, CRM interno, WhatsApp, voz ou outras Skills privadas.`;
