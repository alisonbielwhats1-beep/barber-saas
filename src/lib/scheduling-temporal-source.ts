import { resolveSchedulingDate, type SchedulingFields } from "./scheduling-contract";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, weekdayOfDateKey } from "./time";
import { temporalEvidence, type SchedulingTemporalEvidence } from "../../packages/salon-secretary/src/scheduling-skill";
import { matchesSchedulingPeriod, type TemporalRejection } from "./scheduling-temporal";
import type { PendingTemporalAmbiguity, TemporalAmbiguityContext } from "./scheduling-temporal-ambiguity";
import { pendingCalendarConflicts, type PendingCalendarConflict } from "./scheduling-calendar-conflict";
import { clockComponents, componentClockWitness, maskTemporalSpans, relativeDayComponents } from "./scheduling-temporal-components";
import { validateTemporalNegativeContext, type TemporalNegativeContextInput } from "./scheduling-temporal-negative-context";

const weekdays = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const numbers: Record<string, number> = { zero: 0, uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };
function number(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(" e ");
  return parts.every(p => numbers[p] !== undefined) ? parts.reduce((sum, p) => sum + numbers[p], 0) : NaN;
}
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const dateFields = ["date", "source_date", "end_date"] as const;
const timeFields = ["time", "source_time", "end_time"] as const;
const words = Object.keys(numbers).join("|");
const numeral = `(?:\\d{1,2}|(?:${words})(?: e (?:${words}))?)`;
const hourWords = Object.keys(numbers).filter(k => numbers[k] < 20).join("|");
const hourNumeral = `(?:\\d{1,2}|vinte(?: e (?:uma|um|duas|dois|tres))?|${hourWords})`;


/** Factual recognizers only: no operation, intent or source/destination choice. */
function temporalFacts(text: string, fields: SchedulingFields, timezone: string, now: Date) {
  const today = dateKeyInTimeZone(now, timezone);
  // A denial directly attached to a factual atom is different from denying an
  // operation elsewhere in the message. This does not choose the operation.
  let negated = false;
  const inspect = (at: number) => { if (/\b(?:nao|nunca|jamais)(?:\s+(?:em|na|no|nas|nos|a|as|ao|aos|para|de|do|da|das|dos)){0,3}\s*$/.test(text.slice(0, at))) negated = true; };
  const dates: string[] = [];
  for(const part of relativeDayComponents(text)){
    inspect(part.start);dates.push(part.days===undefined?"INVALID":addCalendarDays(today,part.days));
  }
  let unanchoredCalendarYear = false;
  const days: number[] = [];
  const weekdayMatches = [...text.matchAll(/\b(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/g)].map(m => { inspect(m.index!); return weekdays.indexOf(m[1].replace("-feira", "")); });
  for (const m of text.matchAll(/\b(depois de amanha|amanha|hoje)\b/g)) { inspect(m.index!); dates.push(addCalendarDays(today, m[1] === "hoje" ? 0 : m[1] === "amanha" ? 1 : 2)); }
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) { inspect(m.index!); dates.push(m[1]); }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) {
    inspect(m.index!);
    if (!m[3]) unanchoredCalendarYear = true;
    // An omitted year is a constraint, not permission to infer a different year.
    const year = m[3] ?? fields.date?.slice(0, 4) ?? today.slice(0, 4);
    dates.push(`${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?: de (\d{4}))?\b/g)) {
    inspect(m.index!);
    if (!m[3]) unanchoredCalendarYear = true;
    dates.push(`${m[3] ?? fields.date?.slice(0, 4) ?? today.slice(0, 4)}-${String(months.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  for (const m of text.matchAll(/\bdia (\d{1,2})\b/g)) { inspect(m.index!); days.push(Number(m[1])); }
  const components=clockComponents(text);
  const clocks: string[] = components.map(part=>{inspect(part.start);return part.value??"INVALID";});
  const scalarText=maskTemporalSpans(text,components.map(part=>part.interval??part));
  for (const m of scalarText.matchAll(/\b(\d{1,2})(?:h(?:(\d{2}))?|:(\d{2}))\b/g)) { inspect(m.index!); clocks.push(`${m[1].padStart(2, "0")}:${m[2] ?? m[3] ?? "00"}`); }
  const clockPattern = new RegExp(`(?:\\b(?:as|pelas) |^\\s*)(${hourNumeral})(?:\\s*horas?)?(?: e (meia|${numeral})(?: minutos?)?)?\\b`, "g");
  const wordClockText = scalarText.replace(/\b\d{1,2}(?:h(?:\d{2})?|:\d{2})\b/g, match => " ".repeat(match.length));
  for (const m of wordClockText.matchAll(clockPattern)) {
    if (!/\b(as|pelas)\b/.test(m[0]) && !/^[\s.!?,]*(?:(?:da|a) (?:manha|tarde|noite)[\s.!?,]*)?$/.test(wordClockText.slice(m.index! + m[0].length))) continue;
    inspect(m.index!);
    let hour = number(m[1]); const minute = m[2] === "meia" ? 30 : m[2] ? number(m[2]) : 0;
    // "dez e meia" must not be consumed as a compound number.
    if (hour < 12 && /\b(?:da|a) (tarde|noite)\b/.test(text)) hour += 12;
    clocks.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return { dates, days, weekdayMatches, clocks, negated, unanchoredCalendarYear };
}

/** A denial scopes only the clause of the literal it could govern. The clause is
 * the punctuation-delimited segment containing the literal. Any negator before
 * the literal in that segment counts (including "não quero que ... às 10h");
 * a negator after it counts unless a connector opens a new clause first
 * ("às 10h e não precisa encaixar"). This never infers intent or chooses a
 * value: it only decides whether the conservative rejection applies. */
const clauseBoundary = /[,.;!?()\n]/;
const connectorWord = /\b(?:e|mas|porem|pois|porque|que|se|quando|caso|entao)\b/;
export function temporalLiteralNegated(text: string, start: number, end: number) {
  if (start < 0 || end <= start) return true;
  let from = start, to = end;
  while (from > 0 && !clauseBoundary.test(text[from - 1])) from--;
  while (to < text.length && !clauseBoundary.test(text[to])) to++;
  for (const match of text.slice(from, to).matchAll(/\b(?:nao|nunca|jamais|nem)\b/g)) {
    const at = from + match.index!;
    // Before the literal or inside the quoted literal itself.
    if (at < end) return true;
    if (!connectorWord.test(text.slice(end, at))) return true;
  }
  return false;
}

function sourceNegatesTemporal(text: string, fields: SchedulingFields, timezone: string, now: Date, operation?: string) {
  // A read cannot carry out a negated mutation. Its explicit factual filters
  // remain usable; direct denial of a date/clock still requires clarification.
  if (["appointment.read", "appointment.list", "availability.get"].includes(operation ?? "")) return temporalFacts(text, fields, timezone, now).negated;
  return /\bnao\b/.test(text.replace(/^\s*nao,\s*/, ""));
}

/** The model chooses a semantic role and selector kind. This only narrows its
 * literal evidence to one complete factual atom of that kind. Disconnected
 * discourse dates do not become constraints on an explicitly supplied weekday;
 * adjacent qualifiers (weekday + calendar date) remain one indivisible atom. */
function dateExpressions() {
  const atom = `(?:depois de amanha|amanha|hoje|${weekdays.join("|")})(?:-feira)?|(?:dia )?(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{4})?|\\d{1,2} de (?:${months.join("|")})(?: de \\d{4})?)|dia \\d{1,2}`;
  return new RegExp(`\\b(?:${atom})(?:[\\s,]+(?:${atom}))*\\b`, "g");
}
function clockExpressions() {
  return new RegExp("\\b(?:\\d{1,2}(?:h(?:\\d{2})?|:\\d{2})|"+hourNumeral+"(?:\\s*horas?)?(?: e (?:meia|"+numeral+")(?: minutos?)?)?)(?:\\s+(?:da|a) (?:manha|tarde|noite))?\\b","g");
}
/** A short factual reply contains only recognized temporal atoms and their
 * connectors. Quote length is not evidence of a conversational decision. */
function isTemporalFragment(text: string) {
  const rest=text.replace(dateExpressions()," ").replace(clockExpressions()," ")
    .replace(/\b(?:manha|tarde|noite)\b/g," ")
    .replace(/\b(?:as|a|ao|aos|em|no|na|nas|nos|de|do|da|das|dos|pelas|para|ate|e)\b/g," ")
    .replace(/[\s.,!?;:()[\]-]/g,"");
  return rest.length===0;
}
const canonicalTemporalFragment = (text: string) => normalize(text).replace(/^[\s.,!?;:()[\]-]+|[\s.,!?;:()[\]-]+$/g, "");
function dateWitness(quote: string, raw: SchedulingFields, field: typeof dateFields[number]) {
  const weekday = field === "source_date" ? raw.source_weekday : field === "date" ? raw.weekday : undefined;
  const offset = field === "source_date" ? raw.source_day_offset : field === "date" ? raw.day_offset : undefined;
  const relative=relativeDayComponents(quote);
  const atoms = [...quote.matchAll(dateExpressions())].filter(atom=>!relative.some(part=>atom.index!>=part.start&&atom.index!+atom[0].length<=part.end)).map(atom=>({text:atom[0],offset:atom.index!,relative:false}));
  atoms.push(...relative.map(atom=>({text:quote.slice(atom.start,atom.end),offset:atom.start,relative:true})));
  const candidates = weekday !== undefined ? atoms.filter(atom => new RegExp(`\\b(?:${weekdays.join("|")})\\b`).test(atom.text))
    : offset !== undefined ? atoms.filter(atom => atom.relative||/\b(?:hoje|amanha)\b/.test(atom.text)) : atoms;
  return candidates.length === 1 ? {text:candidates[0].text, offset:candidates[0].offset} : undefined;
}

/** A quote must contain complete temporal atoms. For example, 'amanhã' is
 * literal inside 'depois de amanhã', but is not evidence for day_offset=1. */
function completeTemporalQuote(source: string, quote: string) {
  const at = source.indexOf(quote);
  if (at < 0) return false;
  const end = at + quote.length;
  const components=clockComponents(source);
  for(const part of [...components,...relativeDayComponents(source)]){
    if(part.start<end&&part.end>at&&(part.start<at||part.end>end))return false;
  }
  // One literal temporal expression includes all its numeric/weekday/daypart
  // qualifiers. Clipping a recognized atom must not hide a factual conflict.
  const dateExpression = dateExpressions();
  const clockExpression = new RegExp(`\\b(?:\\d{1,2}(?:h(?:\\d{2})?|:\\d{2})|${hourNumeral}(?:\\s*horas?)?(?: e (?:meia|${numeral})(?: minutos?)?)?)(?:\\s+(?:da|a) (?:manha|tarde|noite))?\\b`, "g");
  const scalarSource=maskTemporalSpans(source,components.map(part=>part.interval??part));
  for (const expression of [dateExpression, clockExpression]) for (const match of (expression===clockExpression?scalarSource:source).matchAll(expression)) {
    const from = match.index!, to = from + match[0].length;
    if (from < end && to > at && (from < at || to > end)) return false;
  }
  return true;
}

/** Bind only explicit relational clauses. This does not choose dates/clocks:
 * each clause still has to corroborate the corresponding model field below.
 * Unrecognized/negative relations keep the conservative clarification path. */
function temporalRoleClauses(text: string, operation?: string) {
  if (!["appointment.change","schedule.block"].includes(operation??"")) return;
  const temporalStart = `(?:\\d|hoje\\b|amanha\\b|depois de amanha\\b|dia\\b|${weekdays.join("\\b|")}\\b|${Object.keys(numbers).join("\\b|")}\\b)`;
  const origin = new RegExp(`\\b(?:de|das|do)\\s+(?=${temporalStart})`).exec(text);
  if (!origin) return;
  const rest = text.slice(origin.index + origin[0].length);
  const destination = (operation==="schedule.block" ? /\b(?:ate|as)\s+(?:as\s+)?/ : /\bpara\s+(?:(?:as|o dia|dia)\s+)?/).exec(rest);
  if (!destination || /[.;!?]/.test(rest.slice(0, destination.index)) || /\bpara\b/.test(rest.slice(destination.index + destination[0].length))) return;
  // A denial inside the origin→destination relation keeps the conservative path;
  // a separate clause (for example a cancellation or block reason) does not.
  const relationEnd = origin.index + origin[0].length + destination.index + destination[0].length;
  const tail = text.slice(relationEnd).search(clauseBoundary);
  if (temporalLiteralNegated(text, origin.index, tail < 0 ? text.length : relationEnd + tail)) return;
  const prefix=text.slice(0,origin.index);
  // A date before the origin clause of a move has no proven role. Keep the
  // fail-safe path instead of silently treating it as origin or destination.
  if(operation==="appointment.change"&&new RegExp(`\\b(?:hoje|amanha|${weekdays.join("|")})\\b|\\d`).test(prefix))return;
  const split = origin.index + origin[0].length + destination.index;
  return { source: (operation==="schedule.block"?prefix:"")+rest.slice(0, destination.index), destination: rest.slice(destination.index + destination[0].length),
    sourceRange: [operation === "schedule.block" ? 0 : origin.index + origin[0].length, split] as const,
    destinationRange: [split + destination[0].length, text.length] as const };
}

/** A conservative source guard, not an interpreter. Never substitutes a model
 * value with a guessed correction. Ambiguous references require clarification. */
function groundSchedulingTemporalBase(previous: SchedulingFields, raw: SchedulingFields, source: string | undefined, timezone: string, now: Date, waitingFor?: string, operation?: string, evidence?: SchedulingTemporalEvidence, retargetedFields = new Set<string>(), negativeContextValid?: boolean): { fields: SchedulingFields; patch: SchedulingFields; rejected: TemporalRejection[] } {
  const unambiguous = { ...raw };
  const selectorConflicts: ("date" | "source_date")[] = [];
  for (const [dateKey, offsetKey, weekdayKey] of [["date", "day_offset", "weekday"], ["source_date", "source_day_offset", "source_weekday"]] as const) {
    const date = raw[dateKey], offset = raw[offsetKey], weekday = raw[weekdayKey];
    if ([date, offset, weekday].filter(v => v !== undefined).length < 2) continue;
    // Multiple selectors may corroborate an explicit date; never override a
    // contradictory one by choosing the model's preferred field.
    const compatible = date && (weekday === undefined || weekdayOfDateKey(date) === weekday) && (offset === undefined || resolveSchedulingDate({day_offset:offset}, timezone, now).date === date);
    delete unambiguous[offsetKey]; delete unambiguous[weekdayKey];
    if (!compatible) { delete unambiguous[dateKey]; selectorConflicts.push(dateKey); }
  }
  const patch = resolveSchedulingDate(unambiguous, timezone, now);
  const fields: SchedulingFields = { ...previous, ...patch };
  const rejected: TemporalRejection[] = [];
  for (const field of selectorConflicts) {
    rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:raw[field] ?? "AMBIGUOUS"});
    delete fields[field]; delete patch[field];
  }
  if (evidence?.length) {
    const proof = temporalEvidence.safeParse(evidence);
    const text = source === undefined ? undefined : normalize(source);
    const clauses = text === undefined ? undefined : temporalRoleClauses(text, operation);
    const roleRanges = clauses ? operation === "schedule.block"
      ? { date: clauses.sourceRange, time: clauses.sourceRange, end_date: clauses.destinationRange, end_time: clauses.destinationRange }
      : { source_date: clauses.sourceRange, source_time: clauses.sourceRange, date: clauses.destinationRange, time: clauses.destinationRange } : {};
    const temporalKeys = [...dateFields, ...timeFields];
    // Evidence verifies effective values; it cannot create an absent value or
    // an additional required selector. Actual missing facts in explicit role
    // clauses are still detected below, independently of evidence labels.
    const keys = temporalKeys.filter(field => patch[field] !== undefined || fields[field] !== undefined && evidence.some(item => item.field === field));
    if (clauses) {
      const roles = operation === "schedule.block"
        ? [[clauses.source, "date", "time"], [clauses.destination, "end_date", "end_time"]] as const
        : [[clauses.source, "source_date", "source_time"], [clauses.destination, "date", "time"]] as const;
      for (const [clause, dateKey, timeKey] of roles) {
        const facts = temporalFacts(clause, { date: fields[dateKey] }, timezone, now);
        if (!fields[dateKey] && facts.dates.length + facts.days.length + facts.weekdayMatches.length && !keys.includes(dateKey)) keys.push(dateKey);
        if (!fields[timeKey] && facts.clocks.length && !keys.includes(timeKey)) keys.push(timeKey);
      }
    }
    // A dormant backend proof, when supplied, keeps its all-or-nothing contract.
    // Otherwise each quoted literal is checked against a denial in its own clause.
    const proofNegative = negativeContextValid === undefined ? undefined : !negativeContextValid;
    for (const field of keys) {
      const entries = proof.success ? proof.data.filter(item => item.field === field) : [];
      const companion = ({date:"time",time:"date",source_date:"source_time",source_time:"source_date",end_date:"end_time",end_time:"end_date"} as const)[field];
      const sameRole = proof.success ? proof.data.filter(item => item.field === companion) : [];
      const range = roleRanges[field as keyof typeof roleRanges];
      const roles = new Set(temporalKeys.filter(key=>patch[key]!==undefined).map(key=>key.startsWith("source_")?"source":key.startsWith("end_")?"end":"target"));
      const scope = range && source !== undefined ? source.slice(range[0],range[1]) : roles.size <= 1 ? source : undefined;
      // Partial evidence is local to a role. A missing date quote must not erase
      // an otherwise proven date just because the clock has its own quote.
      const candidates = entries.length ? entries.length === 1 ? entries : []
        : proof.success ? [...(sameRole.length===1?sameRole:[]),...(scope?[{field,text:scope}]:[])] : [];
      const value = fields[field];
      const isDate = dateFields.some(key => key === field);
      const canonicalField = isDate ? "date" : "time";
      if (proof.success && !entries.length && previous[field] === value && value !== undefined &&
        !candidates.some(entry=>{const facts=temporalFacts(normalize(entry.text),{date:isDate?value:undefined},timezone,now);return isDate?facts.dates.length+facts.days.length+facts.weekdayMatches.length>0:facts.clocks.length>0;})) continue;
      const verified = candidates.some(entry => {
        if (!value || source === undefined || text === undefined || !source.includes(entry.text) || proofNegative === true) return false;
        const context = normalize(entry.text);
        const contextAt = text.indexOf(context);
        // Reads keep their factual scope: only a denial attached to the quoted
        // atom (or inside it) removes a filter; a denied mutation elsewhere does not.
        const read = ["appointment.read", "appointment.list", "availability.get"].includes(operation ?? "");
        const denied = read
          ? contextAt < 0 || /\b(?:nao|nunca|jamais|nem)\b/.test(context) || /\b(?:nao|nunca|jamais|nem)(?:\s+(?:em|na|no|nas|nos|a|as|ao|aos|para|de|do|da|das|dos)){0,3}\s*$/.test(text.slice(0, contextAt))
          : temporalLiteralNegated(text, contextAt, contextAt + context.length);
        if (proofNegative === undefined && denied) return false;
        const atom = isDate ? dateWitness(context, raw, field as typeof dateFields[number]) : {text:context,offset:0};
        if (!atom) return false;
        const quote = atom.text;
        const facts = temporalFacts(quote, {date:isDate?value:undefined}, timezone, now);
        const witnessed = (isDate ? facts.dates.length + facts.days.length + facts.weekdayMatches.length : facts.clocks.length) > 0;
        const quoteAt = text.indexOf(context) + atom.offset;
        const intersectsRole = !range || quoteAt >= 0 && quoteAt < range[1] && quoteAt + quote.length > range[0];
        const componentProof=isDate?undefined:componentClockWitness(text,quote,field,value,proof.success?proof.data.map(item=>({...item,text:normalize(item.text)})):[],raw);
        return completeTemporalQuote(text, quote) && (witnessed||componentProof===true) && intersectsRole &&
          (componentProof===true?facts.clocks.length<=1:componentProof??!groundSchedulingTemporalBase({}, {[canonicalField]:value}, quote, timezone, now).rejected.some(item=>item.field===canonicalField));
      });
      if (!verified) {
        if (!rejected.some(item => item.field === field)) rejected.push({ code: "SOURCE_TEMPORAL_CONFLICT", field, value: value ?? "MISSING" });
        delete fields[field]; delete patch[field];
      }
    }
    // A short answer has a backend-established role. Evidence may corroborate
    // its value but cannot silently retarget it to a different field.
    if (text !== undefined && temporalKeys.some(field => field === waitingFor)) {
      const requested = waitingFor as typeof temporalKeys[number];
      const quote = evidence.length === 1 ? normalize(evidence[0].text) : undefined;
      if (quote !== undefined && canonicalTemporalFragment(quote) === canonicalTemporalFragment(text) && isTemporalFragment(text) && evidence[0].field !== requested) {
        for (const field of new Set([requested, evidence[0].field])) {
          retargetedFields.add(field);
          if (!rejected.some(item => item.field === field)) rejected.push({ code: "SOURCE_TEMPORAL_CONFLICT", field, value: fields[field] ?? "MISSING" });
          delete fields[field]; delete patch[field];
          if (field !== requested && previous[field] !== undefined) { fields[field] = previous[field]; rejected.find(item=>item.field===field)!.retained_value = previous[field]; }
        }
      }
    }
    if (rejected.length) delete fields.appointment_ref;
    return { fields, patch, rejected };
  }
  if (source === undefined) return { fields, patch, rejected };
  const text = normalize(source);
  const clauses = temporalRoleClauses(text, operation);
  if (clauses) {
    const roles = operation==="schedule.block"
      ? [[clauses.source,"date","time"],[clauses.destination,"end_date","end_time"]] as const
      : [[clauses.source,"source_date","source_time"],[clauses.destination,"date","time"]] as const;
    for (const [clause, dateKey, timeKey] of roles) {
      const result = groundSchedulingTemporalBase({}, { ...(fields[dateKey] ? {date:fields[dateKey]} : {}), ...(fields[timeKey] ? {time:fields[timeKey]} : {}) }, clause, timezone, now);
      for (const r of result.rejected) {
        const field = r.field === "date" ? dateKey : r.field === "time" ? timeKey : r.field;
        rejected.push({...r,field}); delete fields[field]; delete patch[field];
      }
    }
    if (rejected.length) delete fields.appointment_ref;
    return {fields,patch,rejected};
  }
  const { dates, days, weekdayMatches, clocks } = temporalFacts(text, fields, timezone, now);
  const hasDate = dates.length > 0 || weekdayMatches.length > 0 || days.length > 0;
  const hasTime = clocks.length > 0;
  // Mutations retain the conservative legacy negation guard. Reads validate
  // factual denials without reinterpreting a negated mutation as their intent.
  const negative = sourceNegatesTemporal(text, fields, timezone, now, operation);
  function reject(keys: readonly (typeof dateFields[number] | typeof timeFields[number])[], fallback: typeof dateFields[number] | typeof timeFields[number]) {
    const active = keys.filter(k => fields[k] !== undefined);
    for (const field of active.length ? active : [fallback]) {
      rejected.push({ code: "SOURCE_TEMPORAL_CONFLICT", field, value: fields[field] ?? "MISSING" });
      delete fields[field]; delete patch[field];
    }
  }
  if (hasDate) {
    const changed = dateFields.filter(k => patch[k] !== undefined && patch[k] !== previous[k]);
    const target = dateFields.find(k => k === waitingFor);
    const active = target ? [target] : changed.length ? changed : dateFields.filter(k => fields[k] !== undefined);
    const ambiguous = negative || new Set(dates).size > 1 || new Set(weekdayMatches).size > 1 || new Set(days).size > 1 || active.length > 1;
    const date = active.length === 1 ? fields[active[0]] : undefined;
    let match = !ambiguous && !!date && isDateKey(date);
    if (match && date) {
      match = dates.every(d => isDateKey(d) && d === date) && days.every(d => d === Number(date.slice(8)));
      if (weekdayMatches.length) match = match && weekdayMatches.every(w => w === weekdayOfDateKey(date));
      if (!dates.length && !days.length && weekdayMatches.length) match = match && date === resolveSchedulingDate({ weekday: weekdayMatches[0] }, timezone, now).date;
    }
    if (!match) reject(active.length ? active : dateFields, target ?? "date");
    if(target)for(const field of dateFields.filter(k=>k!==target&&patch[k]!==undefined&&patch[k]!==previous[k])) {
      reject([field],field); if(previous[field]!==undefined){fields[field]=previous[field];rejected.find(item=>item.field===field)!.retained_value=previous[field];}
    }
  }
  if (hasTime) {
    const changed = timeFields.filter(k => patch[k] !== undefined && patch[k] !== previous[k]);
    const active = changed.length ? changed : timeFields.filter(k => fields[k] !== undefined);
    // Explicit numeric origin -> destination is not an ambiguous list of clocks.
    // Validate each role; never swap or replace a conflicting model value.
    const numericClock = "(\\d{1,2}(?:h(?:\\d{2})?|:\\d{2}))";
    const move = new RegExp(`\\b(?:das|de)\\s+${numericClock}\\s+para\\s+(?:(?:amanha|hoje|depois de amanha)\\s+)?(?:(?:as|pelas)\\s+)?${numericClock}[\\s.!?]*$`).exec(text);
    const clockValue = (value: string) => {
      const [hour, minute = "00"] = value.split(/[h:]/);
      return `${hour.padStart(2, "0")}:${minute || "00"}`;
    };
    if (!negative && move && clocks.length === 2 && !fields.end_time) {
      for (const [field, value] of [["source_time", clockValue(move[1])], ["time", clockValue(move[2])]] as const) {
        if (fields[field] !== value) {
          rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:fields[field] ?? "MISSING"});
          delete fields[field]; delete patch[field];
        }
      }
    } else if (!negative && clocks.length === 1 && timeFields.some(k => k === waitingFor)) {
      // Without role evidence, a referential reply keeps the backend's pending
      // role. Recognizing non-temporal words does not authorize a role change;
      // explicit corrections of another role use the evidence path above.
      const target = waitingFor as typeof timeFields[number];
      if (fields[target] !== clocks[0]) {
        rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field:target,value:fields[target] ?? "MISSING"});
        delete fields[target]; delete patch[target];
      }
      // Answering one pending clock cannot change a different clock implicitly.
      for (const field of timeFields.filter(k => k !== target && patch[k] !== undefined && patch[k] !== previous[k])) {
        retargetedFields.add(field);retargetedFields.add(target);
        rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:patch[field]!});
        delete fields[field]; delete patch[field];
        // The rejected update answers another role; its prior accepted value
        // was not contradicted by the user and remains effective.
        if (previous[field] !== undefined) { fields[field] = previous[field]; rejected.find(item=>item.field===field)!.retained_value = previous[field]; }
      }
    } else if (negative || new Set(clocks).size > 1 || active.length !== 1 || clocks.some(t => t !== fields[active[0]])) reject(active.length ? active : timeFields, "time");
  }
  // Removing a selector also invalidates a previously located appointment.
  if (rejected.length) delete fields.appointment_ref;
  return { fields, patch, rejected };
}

/** Keep a proven clock expression when only its half-day remains unresolved.
 * This never changes the historical interpretation of a directly matching clock. */
function residualClockAmbiguities(raw: SchedulingFields, source: string | undefined, timezone: string,
  now: Date, operation: string | undefined, evidence: SchedulingTemporalEvidence | undefined, rejected: TemporalRejection[], retargetedFields: ReadonlySet<string>) {
  const pending: PendingTemporalAmbiguity[] = [];
  if (source === undefined) return pending;
  const text=normalize(source), clauses=temporalRoleClauses(text,operation);
  const proof=evidence?.length?temporalEvidence.safeParse(evidence):undefined;
  if(proof&&!proof.success)return pending;
  for(const rejection of rejected){
    if(rejection.code!=="SOURCE_TEMPORAL_CONFLICT"||!timeFields.some(field=>field===rejection.field))continue;
    const field=rejection.field as typeof timeFields[number], value=raw[field];
    if(!value)continue;
    // Rejection of a retargeted answer is not a half-day ambiguity. The pending
    // role remains authoritative until explicitly resolved in its own context.
    if(retargetedFields.has(field))continue;
    const range=clauses ? operation==="schedule.block"
      ? field==="time"?clauses.sourceRange:field==="end_time"?clauses.destinationRange:undefined
      : field==="source_time"?clauses.sourceRange:field==="time"?clauses.destinationRange:undefined : undefined;
    const entries=proof?.success?proof.data.filter(item=>item.field===field):[];
    if(entries.length>1)continue;
    const roleCount=timeFields.filter(key=>raw[key]!==undefined).length;
    const expression=entries[0]?.text??(range?source.slice(range[0],range[1]):roleCount===1?source:undefined);
    if(!expression||!source.includes(expression))continue;
    const quote=normalize(expression), at=text.indexOf(quote);
    if(!completeTemporalQuote(text,quote)||range&&(at<range[0]||at+quote.length>range[1]))continue;
    if(temporalLiteralNegated(text,at,at+quote.length))continue;
    if(/\b(manha|tarde|noite)\b/.test(quote))continue;
    const facts=temporalFacts(quote,raw,timezone,now);
    if(facts.negated||facts.clocks.length!==1)continue;
    const clockAtoms=new RegExp("\\b(?:\\d{1,2}(?:h(?:\\d{2})?|:\\d{2})|(?:"+hourNumeral+")(?:\\s*horas?)?(?: e (?:meia|"+numeral+")(?: minutos?)?)?)\\b","g");
    if([...quote.replace(dateExpressions()," ").matchAll(clockAtoms)].length!==1)continue;

    const literal=facts.clocks[0], hour=Number(literal.slice(0,2));
    if(hour<1||hour>12)continue;
    const other=String((hour+12)%24).padStart(2,"0")+literal.slice(2);
    if(value!==other)continue;
    pending.push({field,kind:"CLOCK_DAYPART",expression,candidates:[literal,other]});
  }
  return pending;
}

/** Explain only a contradiction inside one complete, role-bound calendar atom.
 * A model/date disagreement alone does not mean the user contradicted themself. */
function calendarContradictions(raw: SchedulingFields, source: string | undefined, timezone: string,
  now: Date, operation: string | undefined, evidence: SchedulingTemporalEvidence | undefined,
  rejected: TemporalRejection[], retargetedFields: ReadonlySet<string>) {
  const pending: PendingCalendarConflict[] = [];
  if (source === undefined) return pending;
  const text = normalize(source), clauses = temporalRoleClauses(text, operation);
  const proof = evidence?.length ? temporalEvidence.safeParse(evidence) : undefined;
  if (proof && !proof.success) return pending;
  const activeRoles = new Set(dateFields.filter(field => raw[field] !== undefined ||
    field === "date" && (raw.weekday !== undefined || raw.day_offset !== undefined) ||
    field === "source_date" && (raw.source_weekday !== undefined || raw.source_day_offset !== undefined)));
  const atoms = [...text.matchAll(dateExpressions())];
  for (const field of dateFields) {
    if (retargetedFields.has(field) || !rejected.some(item => item.code === "SOURCE_TEMPORAL_CONFLICT" && item.field === field)) continue;
    const range = clauses ? operation === "schedule.block"
      ? field === "date" ? clauses.sourceRange : field === "end_date" ? clauses.destinationRange : undefined
      : field === "source_date" ? clauses.sourceRange : field === "date" ? clauses.destinationRange : undefined : undefined;
    const entries = proof?.success ? proof.data.filter(item => item.field === field) : [];
    if (entries.length > 1) continue;
    const quote = entries[0]?.text;
    if (quote && !source.includes(quote)) continue;
    // A clipped literal still points to its indivisible adjacent calendar atom.
    // Never collect a weekday from another role or a disconnected sentence.
    const quoteAt = quote === undefined ? undefined : text.indexOf(normalize(quote));
    const candidates = atoms.filter(atom => {
      const start = atom.index!, end = start + atom[0].length;
      if (range && (start < range[0] || end > range[1])) return false;
      if (temporalLiteralNegated(text, start, end)) return false;
      if (quoteAt !== undefined) return start < quoteAt + normalize(quote!).length && end > quoteAt;
      return !!range || activeRoles.size === 1 && activeRoles.has(field);
    });
    if (candidates.length !== 1) continue;
    const conflicts = candidates.flatMap(atom => {
      const facts = temporalFacts(atom[0], {date:raw[field]}, timezone, now);
      const dates = [...new Set(facts.dates)], stated = [...new Set(facts.weekdayMatches)];
      // A model-inferred year is not evidence of a contradiction by the user.
      if (facts.negated || facts.unanchoredCalendarYear || dates.length !== 1 || stated.length !== 1 || !isDateKey(dates[0])) return [];
      const actual = weekdayOfDateKey(dates[0]);
      if (actual === stated[0]) return [];
      return [{field, kind:"WEEKDAY_DATE_CONFLICT" as const, expression:atom[0], calendar_date:dates[0], stated_weekday:stated[0], actual_weekday:actual}];
    });
    if (conflicts.length === 1) pending.push(conflicts[0]);
  }
  return pendingCalendarConflicts.parse(pending);
}

/** A short qualifier can select only one candidate of a live, requested role.
 * A backend draft contains the earlier literal; the current quote proves the
 * remaining component. Neither message alone authorizes an invented clock. */
export function groundSchedulingTemporal(previous: SchedulingFields, raw: SchedulingFields,
  source: string | undefined, timezone: string, now: Date, waitingFor?: string, operation?: string,
  evidence?: SchedulingTemporalEvidence, context?: TemporalAmbiguityContext, negativeContext?: TemporalNegativeContextInput) {
  const patch={...raw};
  let resolved: PendingTemporalAmbiguity|undefined;
  let resolvedCalendar: {field: typeof dateFields[number]; date: string}|undefined;
  const live=context&&context.draft_ref&&Number.isInteger(context.draft_revision)&&context.draft_revision>0&&
    context.scope_valid!==false&&Date.parse(context.expires_at)>now.getTime();
  const responseFacts=source===undefined?undefined:temporalFacts(normalize(source),{},timezone,now);
  const referential=!!responseFacts&&!responseFacts.dates.length&&!responseFacts.days.length&&!responseFacts.weekdayMatches.length&&!responseFacts.clocks.length;
  const calendar=context?.pending_calendar_conflicts?.find(item=>item.field===waitingFor);
  if(live&&calendar&&referential&&source!==undefined&&/[\p{L}\p{N}]/u.test(source)&&
    !/\b(?:nao|nunca|jamais|nem)\b/.test(normalize(source))&&!sourceNegatesTemporal(normalize(source),raw,timezone,now,operation)){
    const proof=temporalEvidence.safeParse(evidence??[]);
    const entries=proof.success?proof.data.filter(item=>item.field===calendar.field):[];
    const quote=entries.length===1?entries[0].text:undefined;
    const weekdayKey=calendar.field==="date"?"weekday":calendar.field==="source_date"?"source_weekday":undefined;
    const allowed=new Set<string>([calendar.field,...(weekdayKey?[weekdayKey]:[])]);
    const scopeUnchanged=Object.entries(raw).every(([key,value])=>allowed.has(key)||value===previous[key as keyof SchedulingFields]);
    const selectedDate=raw[calendar.field];
    const selectedWeekday=weekdayKey?raw[weekdayKey]:undefined;
    // Luna selects one published reference through existing typed date/weekday
    // fields. The backend binds that semantic choice to this exact pending role;
    // it does not infer which Portuguese phrase means "use the calendar date".
    if(scopeUnchanged&&quote&&source.includes(quote)&&canonicalTemporalFragment(quote)===canonicalTemporalFragment(source)&&
      ((selectedDate===calendar.calendar_date&&selectedWeekday===undefined)||
       (selectedDate===undefined&&selectedWeekday===calendar.stated_weekday))){
      const chosen=selectedDate??resolveSchedulingDate({weekday:calendar.stated_weekday},timezone,now).date!;
      resolvedCalendar={field:calendar.field,date:chosen};
      delete patch[calendar.field];if(weekdayKey)delete patch[weekdayKey];
    }
  }
  if(live&&source!==undefined){
    const candidate=context.pending_temporal_ambiguities?.find(item=>item.field===waitingFor);
    const proof=temporalEvidence.safeParse(evidence??[]);
    const entries=proof.success?proof.data.filter(item=>item.field===waitingFor):[];
    const quote=entries.length===1?entries[0].text:undefined;
    if(candidate&&quote&&source.includes(quote)&&raw[candidate.field]&&candidate.candidates.includes(raw[candidate.field]!)&&
      !/\b(?:nao|nunca|jamais|nem)\b/.test(normalize(source))){
      const facts=temporalFacts(normalize(source),{},timezone,now);
      const dayparts=[...new Set([...normalize(source).matchAll(/\b(manha|tarde|noite)\b/g)].map(match=>({manha:"morning",tarde:"afternoon",noite:"evening"} as const)[match[1] as "manha"|"tarde"|"noite"]))];
      const quotedDayparts=[...new Set([...normalize(quote).matchAll(/\b(manha|tarde|noite)\b/g)].map(match=>({manha:"morning",tarde:"afternoon",noite:"evening"} as const)[match[1] as "manha"|"tarde"|"noite"]))];
      if(Object.entries(raw).every(([key,value])=>["time","source_time","end_time","period"].includes(key)||value===previous[key as keyof SchedulingFields])&&
        !facts.clocks.length&&!facts.dates.length&&!facts.days.length&&!facts.weekdayMatches.length&&dayparts.length===1&&
        quotedDayparts.length===1&&quotedDayparts[0]===dayparts[0]&&
        completeTemporalQuote(normalize(source),normalize(quote))&&
        candidate.candidates.filter(time=>matchesSchedulingPeriod(time,dayparts[0])).length===1&&
        matchesSchedulingPeriod(raw[candidate.field]!,dayparts[0])&&
        timeFields.every(field=>field===candidate.field||raw[field]===undefined||raw[field]===previous[field])){
        resolved=candidate;delete patch[candidate.field];
        // A qualifier for the original/final clock is not a destination filter.
        delete patch.period;
      }
    }
  }
  const proof=resolved||resolvedCalendar?evidence?.filter(item=>item.field!==resolved?.field&&item.field!==resolvedCalendar?.field):evidence;
  const retargetedFields=new Set<string>();
  const negativeContextValid=negativeContext===undefined?undefined:source!==undefined&&validateTemporalNegativeContext(negativeContext,
    {source,previous,raw:patch,evidence:proof,operation,now}).valid;
  const result=groundSchedulingTemporalBase(previous,patch,source,timezone,now,waitingFor,operation,proof,retargetedFields,negativeContextValid);
  if(negativeContextValid===false){
    const present=[...dateFields,...timeFields].filter(field=>result.fields[field]!==undefined);
    for(const field of present.length?present:["date"] as const){
      if(!result.rejected.some(item=>item.field===field))result.rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:result.fields[field]??"MISSING"});
      delete result.fields[field];delete result.patch[field];
    }
    delete result.fields.appointment_ref;
  }
  if((source===undefined||referential)&&!resolvedCalendar&&(context?.pending_calendar_conflicts?.length||dateFields.some(field=>field===waitingFor)))for(const field of dateFields){
    const supplied=raw[field]!==undefined&&raw[field]!==previous[field]||field==="date"&&(raw.weekday!==undefined||raw.day_offset!==undefined)||field==="source_date"&&(raw.source_weekday!==undefined||raw.source_day_offset!==undefined);
    if(supplied){
      if(!result.rejected.some(item=>item.field===field))result.rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:raw[field]??"AMBIGUOUS"});
      delete result.fields[field];delete result.patch[field];
      if(previous[field]!==undefined){result.fields[field]=previous[field];result.rejected.find(item=>item.field===field)!.retained_value=previous[field];}
    }
  }
  if(!resolved&&source!==undefined&&/\b(manha|tarde|noite)\b/.test(normalize(source))&&!temporalFacts(normalize(source),{},timezone,now).clocks.length){
    for(const field of timeFields)if(raw[field]!==undefined&&raw[field]!==previous[field]){
      if(!result.rejected.some(item=>item.field===field))result.rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field,value:raw[field]!});
      delete result.fields[field];delete result.patch[field];
    }
  }
  if(!resolved)for(const item of context?.pending_temporal_ambiguities??[]){
    if(raw[item.field]!==undefined&&(source===undefined||!temporalFacts(normalize(source),{},timezone,now).clocks.length)){
      if(!result.rejected.some(rejection=>rejection.field===item.field))result.rejected.push({code:"SOURCE_TEMPORAL_CONFLICT",field:item.field,value:raw[item.field]!});
      delete result.fields[item.field];delete result.patch[item.field];
    }
  }
  if(resolved&&!result.rejected.length){
    result.fields[resolved.field]=raw[resolved.field];result.patch[resolved.field]=raw[resolved.field];
  }
  if(resolvedCalendar&&!result.rejected.length){
    result.fields[resolvedCalendar.field]=resolvedCalendar.date;result.patch[resolvedCalendar.field]=resolvedCalendar.date;
  }
  return {...result,pending_temporal_ambiguities:residualClockAmbiguities(raw,source,timezone,now,operation,evidence,result.rejected,retargetedFields),
    pending_calendar_conflicts:calendarContradictions(raw,source,timezone,now,operation,evidence,result.rejected,retargetedFields)};
}
