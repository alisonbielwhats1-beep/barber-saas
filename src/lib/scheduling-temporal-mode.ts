import { AsyncLocalStorage } from "node:async_hooks";
import type { SchedulingTemporalEvidence } from "../../packages/salon-secretary/src/scheduling-skill";
import { temporalComponentsEnabled, type ClockComponent, type DayComponent } from "../../packages/salon-secretary/src/temporal-components";
import { literalProofSpans } from "../../packages/salon-secretary/src/literal-match";
import { resolveSchedulingDate, type SchedulingFields } from "./scheduling-contract";
import { componentRoleRelation, groundSchedulingTemporal, groundWithExclusions, negatedPredicate, temporalExclusionsOf, temporalQuoteDenied } from "./scheduling-temporal-source";
import { ownedNegators, rejectExcludedValues, splitTemporalExclusions } from "./scheduling-temporal-polarity";
import { coherentIntervalReadings, dateRulesV2Enabled, dayDirection, daypartAnswer, daypartRulesV2Enabled, foldTemporal, resolveClockComponent, resolveDayComponent, temporalScan, type ClockVerdict, type DayVerdict, type Witness } from "./scheduling-temporal-reference";
import { validateTemporalNegativeContext, type TemporalNegativeContextInput } from "./scheduling-temporal-negative-context";
import type { PendingTemporalAmbiguity, TemporalAmbiguityContext } from "./scheduling-temporal-ambiguity";
import type { PendingCalendarConflict } from "./scheduling-calendar-conflict";
import type { TemporalRejection } from "./scheduling-temporal";
import { dateKeyInTimeZone } from "./time";

/** C1 temporal components (flag SALON_SECRETARY_TEMPORAL_COMPONENTS, default off).
 * Evidence entries carrying a `component` are verified here: the quote must be ONE tolerant
 * whole-token span of the action's scoped source, not denied in its own clause, inside its role's
 * clause of an explicit origin→destination/start→end relation, and token-consistent with the
 * component over the WHOLE temporal expression around it (scheduling-temporal-reference.ts); one
 * written number never proves both a day and a clock, and a number beside a day that no clock
 * role explains is asked. The backend computes the value from the salon clock. Without components, or with the flag off, the historical grounding decides
 * alone and unchanged. With the flag on the historical grammar still runs on the same quotes and
 * values, effective for the roles given by legacy selectors and as a codes-only shadow for the
 * component roles. The result keeps the historical shape. */
type Grounded = ReturnType<typeof groundSchedulingTemporal>;
type Role = "date" | "source_date" | "end_date" | "time" | "source_time" | "end_time";
/** `dropped`/`expression` (EXISTING, flag): the past reading removed and the quote; `hint`: the readings of a negated origin predicate
 * and `hintDropped` the past reading its day dropped. */
type Verdict = { role: Role; code: string; value?: string; shadow?: string; pending?: PendingTemporalAmbiguity | PendingCalendarConflict; dropped?: string; expression?: string; hint?: string[];
  hintDropped?: string[]; resolved?: [string, string] };
/** Flag SALON_SECRETARY_DATE_RULES_V2 only. `past_readings`: a mutation role's day whose past reading was dropped ("dia 1" =
 * 01/10, 01/09 já passou), shown before Confirmar. `locator_hints`: a change's origin said only in a negated predicate
 * ("não pode no dia 06/10"): a constraint on the located appointment, never a value. `dropped`: the past reading that day
 * dropped ("não pode no dia 1" = 01/10, 01/09 já passou): the locator checks it as for a past reading (B1). */
export type PastReading = { field: "date" | "source_date"; date: string; dropped: string; expression: string };
export type LocatorHint = { field: "source_date"; dates: string[]; expression: string; dropped?: string[] };
/** Flag SALON_SECRETARY_DAYPART_RULES_V2 only: a half-day choice the other end of the same single-day interval settled
 * ("11 horas… até as duas" → end 14:00). Codes, fields and clocks only. */
export type DaypartResolution = { field: "time" | "end_time"; code: "DAYPART_RESOLVED_BY_INTERVAL"; candidates: [string, string]; value: string; expression: string };
type GroundedTurn = Grounded & { past_readings?: PastReading[]; locator_hints?: LocatorHint[]; daypart_resolutions?: DaypartResolution[] };
/** `equal` is null when the historical grammar was not evaluated for the role (no value to compare). */
export type TemporalShadowEntry = { field: Role; legacy: string; components: string; equal: boolean | null };

const shadowSink = new AsyncLocalStorage<(entries: TemporalShadowEntry[]) => void>();
/** Per-message observer (router trace). Codes and closed field names only, never text or values. */
export function withTemporalShadowObserver<T>(sink: (entries: TemporalShadowEntry[]) => void, task: () => T): T {
  return shadowSink.run(sink, task);
}
const dateSelectors = { date: ["day_offset", "weekday"], source_date: ["source_day_offset", "source_weekday"], end_date: [] } as const;
const isDate = (role: Role): role is "date" | "source_date" | "end_date" => role.endsWith("date");

/** The value a legacy selector of the same role states (already typed), for agreement only. */
function legacyValue(raw: SchedulingFields, role: Role, timezone: string, now: Date) {
  if (!isDate(role)) return raw[role];
  const [offset, weekday] = dateSelectors[role] as readonly (keyof SchedulingFields)[];
  const selected = { date: raw[role], ...(offset ? { day_offset: raw[offset] as number | undefined, weekday: raw[weekday] as number | undefined } : {}) };
  if (Object.values(selected).every(value => value === undefined)) return;
  try { return resolveSchedulingDate(selected, timezone, now).date ?? "AMBIGUOUS"; } catch { return "AMBIGUOUS"; }
}
const liveContext = (context: TemporalAmbiguityContext | undefined, now: Date) => !!context && !!context.draft_ref && Number.isInteger(context.draft_revision) &&
  context.draft_revision > 0 && context.scope_valid !== false && Date.parse(context.expires_at) > now.getTime();

function componentVerdicts(entries: SchedulingTemporalEvidence, source: string | undefined, raw: SchedulingFields, timezone: string, now: Date,
  operation: string | undefined, context: TemporalAmbiguityContext | undefined, waitingFor: string | undefined, owned: readonly [number, number][] = [], excludedRoles: ReadonlySet<string> = new Set(),
  previous: SchedulingFields = {}, legacyQuotes: SchedulingTemporalEvidence = []): Verdict[] {
  const today = dateKeyInTimeZone(now, timezone), verdicts: Verdict[] = [];
  const scan = source === undefined ? undefined : temporalScan(source), relation = source === undefined ? undefined : componentRoleRelation(source, operation, owned);
  const located = entries.map(entry => {
    const spans = source === undefined ? [] : literalProofSpans(source, entry.text), span = spans.length === 1 ? spans[0] : undefined;
    return { entry, role: entry.field as Role, span, count: spans.length, widened: span && scan ? scan.widen(span[0], span[1]) : undefined };
  });
  const shadowOf = (role: Role, component: DayComponent | ClockComponent) => {
    if (isDate(role)) { const r = resolveDayComponent(component as DayComponent, today, dayDirection(role, operation)); return r.status === "OK" ? r.date : r.status === "DATE_CHOICE" ? r.candidates[0] : undefined; }
    const r = resolveClockComponent(component as ClockComponent); return r.status === "OK" ? r.time : undefined;
  };
  // Each role quote lies in its own clause of an explicit relation ("de … para/pra …", "das … às …");
  // the only day of a single-day block may follow its interval ("das 10 às 11 do dia 28").
  const inRole = (role: Role, [start, end]: [number, number]) => {
    if (!relation) return true;
    const hit = ([a, b]: readonly [number, number]) => start < b && end > a, { origin, destination, endSegment } = relation;
    if (operation !== "schedule.block") return role.startsWith("source_") ? hit(origin) : role === "date" || role === "time" ? hit(destination) : true;
    if (role === "time") return hit(origin);
    if (role === "end_time" || role === "end_date") return hit(destination);
    return role !== "date" || hit(origin) || !located.some(item => item.role === "end_date") && !!scan && !scan.statesDay(origin[0], origin[1]) && hit([destination[0], endSegment[1]]);
  };
  // time and end_time of ONE written interval (the same widened expression) bind by position.
  const interval = (() => {
    const [start, end] = (["time", "end_time"] as const).map(role => located.find(item => item.role === role));
    return scan && start?.widened && end?.widened && start.widened.from === end.widened.from && start.widened.to === end.widened.to
      ? scan.interval({ ...start.widened, quoteAt: Math.min(start.widened.quoteAt, end.widened.quoteAt) }, start.entry.component as ClockComponent, end.entry.component as ClockComponent, { operation })
      : undefined;
  })();
  type Proof = { verdict: DayVerdict | ClockVerdict; witness: Witness; free?: Witness; readings?: string[] };
  const v2 = dateRulesV2Enabled(), live = liveContext(context, now);
  // B6 (flag): destination quotes of a change, each located once (the negated origin predicate needs all of them).
  // C4 R-B1: a destination Luna quoted on the legacy wire beside a component origin is one of them too (same rule).
  const destinations = [...located.filter(item => item.role === "date" || item.role === "time"), ...legacyQuotes.filter(entry => entry.field === "date" || entry.field === "time")
    .map(entry => { const spans = source === undefined ? [] : literalProofSpans(source, entry.text); return { span: spans.length === 1 ? spans[0] : undefined }; })];
  const results = located.map(({ entry, role, span, count, widened }): { role: Role; shadow?: string; code?: string; quote?: string; proof?: Proof; hint?: string[]; hintDropped?: string[]; answer?: string; repeated?: boolean } => {
    const component = entry.component!, shadow = shadowOf(role, component);
    if (!span) return { role, shadow, code: count ? "LITERAL_REPEATED" : "LITERAL_ABSENT" };
    if (!widened || !scan) return { role, shadow, code: "LITERAL_UNMAPPABLE" };
    if (temporalQuoteDenied(source!, span[0], span[1], operation, owned)) {
      // B6 (flag): "a Rosângela não pode no dia 06/10. Remarque ela pro dia 02/10": the origin is only a locator constraint.
      if (!v2 || role !== "source_date" || operation !== "appointment.change" || excludedRoles.has(role) || destinations.some(item => !item.span) ||
        !negatedPredicate(source!, span, destinations.map(item => item.span!), raw.customer_name)) return { role, shadow, code: "NEGATED" };
      // A day that already passed (a past candidate, a day of a written month already past, a past weekday) may be what the
      // sentence is about: never a hint toward another, future appointment; the historical denial asks the original day. A day
      // of the month with NO month written ("não pode no dia 1", "não veio dia 25") is its next occurrence carrying the dropped
      // past one: the locator never selects by it while that customer has an appointment of any status on the past day (B1).
      const reading = scan.day(widened, component as DayComponent, today, { direction: dayDirection(role, operation), role, operation }).verdict;
      const monthless = (component as DayComponent).month === null;
      const hint = reading.status === "OK" && (!reading.dropped || monthless) ? [reading.date] : reading.status === "DATE_CHOICE" ? [...reading.candidates] : [];
      const hintDropped = reading.status === "OK" && reading.dropped && monthless ? [reading.dropped] : undefined;
      return hint.length && hint.every(date => date >= today) ? { role, code: "SOURCE_NEGATED_PREDICATE", quote: source!.slice(span[0], span[1]), hint, ...(hintDropped ? { hintDropped } : {}) }
        : { role, shadow, code: "NEGATED" };
    }
    if (!inRole(role, span)) return { role, shadow, code: "ROLE_RANGE" };
    const proof: Proof = isDate(role) ? scan.day(widened, component as DayComponent, today, { direction: dayDirection(role, operation), role, operation, answer: waitingFor === role })
      : interval && (role === "time" || role === "end_time") ? interval[role === "time" ? 0 : 1] : scan.clock(widened, component as ClockComponent, { role, operation });
    // UX (flag): a live DATE_CHOICE of this role is answered by the calendar facts of the answer ("o de outubro", "do mês
    // que vem") when they single out one published candidate the component does not contradict; a negator anywhere in the
    // answer selects nothing. The same choice re-created by the answer ("dia 1" again) is an answer not understood.
    const choice = v2 && live && isDate(role) ? context!.pending_calendar_conflicts?.find(item => item.field === role && item.kind === "DATE_CHOICE") : undefined;
    const open = choice?.kind === "DATE_CHOICE" && (proof.verdict.status === "REJECTED" || proof.verdict.status === "DATE_CHOICE") ? choice : undefined;
    const answer = open && !/\b(?:nao|nunca|jamais|nem)\b/.test(foldTemporal(source!)) ? scan.dateAnswer(widened, open.candidates, today) : undefined;
    // Luna's own component must name the answer: an invalid (REJECTED) component never agrees.
    const own = answer === undefined ? undefined : resolveDayComponent(component as DayComponent, today, dayDirection(role, operation));
    const agrees = !!own && (own.status === "OK" ? own.date === answer : own.status === "DATE_CHOICE" && own.candidates.includes(answer!));
    const repeated = !!open && waitingFor === role && proof.verdict.status === "DATE_CHOICE" && proof.verdict.candidates.join() === open.candidates.join();
    // Questions repeat what was quoted (the located span), never the widened expression.
    return { role, shadow, quote: source!.slice(span[0], span[1]), proof, ...(agrees ? { answer } : repeated ? { repeated } : {}) };
  });
  // C3 (flag): the two ends of ONE single-day interval ("11 horas… até as duas", "das 10 às 2") keep only readings the words allow
  // with the end after the start (never across midnight), and only while the words leave a real half-day doubt (two clocks the
  // words fix keep END_NOT_AFTER_START). One coherent pair: both values; several: each end left with two readings is asked (an
  // 8-11 end included: its morning default is never proof); none: unchanged.
  const coherent = new Map<Role, [string, string]>();
  if (daypartRulesV2Enabled()) {
    const [start, end] = (["time", "end_time"] as const).map(role => results.find(item => item.role === role && item.proof));
    const readings = (proof: Proof | undefined) => proof?.verdict.status === "OK" && "time" in proof.verdict ? proof.readings ?? [proof.verdict.time]
      : proof?.verdict.status === "DAYPART_CHOICE" ? [...proof.verdict.candidates] : undefined;
    const singleDay = !located.some(item => item.role === "end_date") && (raw.end_date === undefined || raw.end_date === raw.date) &&
      (previous.end_date === undefined || previous.end_date === previous.date);
    const [a, b] = [readings(start?.proof), readings(end?.proof)], doubt = [start, end].some(item => item?.proof?.verdict.status === "DAYPART_CHOICE");
    const pairs = start && end && a && b && singleDay && doubt ? coherentIntervalReadings(a, b) : [];
    if (pairs.length) for (const [item, values] of [[start!, [...new Set(pairs.map(pair => pair[0]))]], [end!, [...new Set(pairs.map(pair => pair[1]))]]] as const) {
      const proof = item.proof!, was = proof.verdict;
      if (values.length === 1) { item.proof = { ...proof, verdict: { status: "OK", time: values[0] } }; if (was.status === "DAYPART_CHOICE") coherent.set(item.role, was.candidates); }
      else item.proof = { ...proof, verdict: { status: "DAYPART_CHOICE", candidates: [...values].sort() as [string, string] } };
    }
  }
  // One written number never proves both a day and a clock; a number beside a day ("amanhã 10")
  // must be the clock another role proves, else the day is asked ("sexta 13").
  const accepted = (item: typeof results[number]) => item.proof && item.proof.verdict.status !== "REJECTED" ? item.proof.witness : [];
  const meets = (a: [number, number], list: Witness) => list.some(b => a[0] < b[1] && b[0] < a[1]);
  const clocks = results.filter(item => !isDate(item.role)).flatMap(accepted);
  const days = results.filter(item => isDate(item.role) && accepted(item).some(span => meets(span, clocks)));
  const shared = new Set<Role>([...days.map(item => item.role),
    ...results.filter(item => !isDate(item.role) && accepted(item).some(span => days.some(day => meets(span, accepted(day))))).map(item => item.role)]);
  for (const item of results) {
    const { role, shadow } = item;
    const verdict = (code: string, extra: Partial<Verdict> = {}) => verdicts.push({ role, code, ...(shadow !== undefined ? { shadow } : {}), ...extra });
    if (!item.proof) { verdict(item.code!, item.hint ? { hint: item.hint, expression: item.quote, ...(item.hintDropped ? { hintDropped: item.hintDropped } : {}) } : {}); continue; }
    if (shared.has(role)) { verdict("WITNESS_SHARED"); continue; }
    let result = item.proof.verdict;
    // A day to book or block is never a past one, even when the owner's answer names it (as for an explicit past year).
    if (item.answer !== undefined && dayDirection(role, operation) === "FORWARD" && item.answer < today) { verdict("DATE_IN_PAST"); continue; }
    if (item.answer !== undefined) result = { status: "OK", date: item.answer };
    else if (item.repeated) { verdict("DATE_CHOICE_REPEATED"); continue; }
    if (result.status !== "REJECTED" && item.proof.free?.some(span => !meets(span, clocks))) { verdict("TOKEN_MISMATCH"); continue; }
    const quote = item.quote!;
    // A live half-day question may be answered by the daypart alone ("da tarde").
    const pending = liveContext(context, now) ? context!.pending_temporal_ambiguities?.find(entry => entry.field === role) : undefined;
    const answered = pending && result.status === "REJECTED" && result.code === "TOKEN_MISMATCH" ? daypartAnswer(quote, pending.candidates) : undefined;
    if (answered !== undefined && answered === shadow) result = { status: "OK", time: answered };
    const legacy = legacyValue(raw, role, timezone, now);
    switch (result.status) {
      case "OK": {
        const value = "date" in result ? result.date : result.time, dropped = "dropped" in result ? result.dropped : undefined;
        if (legacy !== undefined && legacy !== value) verdict("SELECTOR_CONFLICT");
        else verdict("OK", { value, shadow: value, ...(dropped ? { dropped, expression: quote } : {}), ...(coherent.has(role) ? { resolved: coherent.get(role), expression: quote } : {}) });
        break;
      }
      case "DAYPART_CHOICE":
        verdict("DAYPART_CHOICE", { pending: { field: role as "time", kind: "CLOCK_DAYPART", expression: quote, candidates: result.candidates } }); break;
      case "DATE_CHOICE":
        verdict("DATE_CHOICE", { pending: { field: role as "date", kind: "DATE_CHOICE", expression: quote, candidates: result.candidates } }); break;
      case "WEEKDAY_CONFLICT":
        verdict("WEEKDAY_CONFLICT", { shadow: result.calendar_date, pending: { field: role as "date", kind: "WEEKDAY_DATE_CONFLICT", expression: quote,
          calendar_date: result.calendar_date, stated_weekday: result.stated_weekday, actual_weekday: result.actual_weekday } }); break;
      default: verdict(result.code);
    }
  }
  return verdicts;
}

function legacyCode(grounded: Grounded, verdict: Verdict) {
  const role = verdict.role;
  if (verdict.shadow === undefined) return "NOT_EVALUATED";
  if (grounded.pending_temporal_ambiguities.some(item => item.field === role)) return "DAYPART_CHOICE";
  if (grounded.pending_calendar_conflicts.some(item => item.field === role)) return "CALENDAR_CONFLICT";
  return grounded.rejected.some(item => item.field === role) || grounded.fields[role] !== verdict.shadow ? "REJECTED" : "OK";
}
function report(grounded: Grounded, verdicts: readonly Verdict[]) {
  try {
    const entries = verdicts.map(verdict => { const legacy = legacyCode(grounded, verdict);
      return { field: verdict.role, legacy, components: verdict.code, equal: legacy === "NOT_EVALUATED" ? null : (legacy === "OK") === (verdict.code === "OK") }; });
    if (entries.length) shadowSink.getStore()?.(entries);
  } catch { /* Observation only: never changes or fails the turn. */ }
}

/** C2 guard (the caller's flag SALON_SECRETARY_DAYPART_BY_HOURS): whether the action's message writes a daypart outside the
 * expressions of its own clock quotes — the day's ("amanhã de manhã") or a loose one ("…, à noite"). The owner's half of the
 * day is then theirs to settle: the salon's hours never pick a reading against it. A greeting is never a daypart (flag V2);
 * unmappable text counts as written. */
export function daypartWrittenOutside(source: string, clockQuotes: readonly string[]) {
  const scan = temporalScan(source);
  if (!scan) return true;
  const own = clockQuotes.flatMap(quote => literalProofSpans(source, quote).map(([start, end]) => scan.widen(start, end)));
  const facts = scan.facts(0, Number.MAX_SAFE_INTEGER);
  return facts.daypartAt.some(({ i }) => { const token = facts.list[i]; return !own.some(span => token.at >= span.from && token.to <= span.to); });
}
/** B5: a role whose selectors contradicted each other in the model's answer (decoder `conflict` marker)
 * is rejected here for every adapter: no value of that role survives (not even the accepted one, which the
 * owner was changing), and the backend asks for it. The cause is kept as SELECTOR_CONFLICT. */
export const SELECTOR_CONFLICT = "SELECTOR_CONFLICT";
function rejectSelectorConflicts(grounded: Grounded, roles: readonly Role[]): Grounded {
  for (const field of roles) {
    delete grounded.fields[field]; delete grounded.patch[field];
    grounded.rejected = [...grounded.rejected.filter(item => item.field !== field), { code: "SOURCE_TEMPORAL_CONFLICT", field, value: SELECTOR_CONFLICT }];
    grounded.pending_temporal_ambiguities = grounded.pending_temporal_ambiguities.filter(item => item.field !== field);
    grounded.pending_calendar_conflicts = grounded.pending_calendar_conflicts.filter(item => item.field !== field);
  }
  delete grounded.fields.appointment_ref;
  return grounded;
}
/** Drop-in for groundSchedulingTemporal (same inputs and result shape). */
export function groundSchedulingTemporalTurn(previous: SchedulingFields, raw: SchedulingFields, source: string | undefined, timezone: string, now: Date,
  waitingFor?: string, operation?: string, evidence?: SchedulingTemporalEvidence, context?: TemporalAmbiguityContext, negativeContext?: TemporalNegativeContextInput): GroundedTurn {
  const conflicts = [...new Set((evidence ?? []).filter(entry => entry.conflict).map(entry => entry.field as Role))];
  if (conflicts.length) {
    // A marker proves nothing: the other roles are grounded exactly as without it.
    const plain = evidence!.filter(entry => !entry.conflict);
    return rejectSelectorConflicts(groundSchedulingTemporalTurn(previous, raw, source, timezone, now, waitingFor, operation, plain.length ? plain : undefined, context, negativeContext), conflicts);
  }
  const entries = (evidence ?? []).filter(entry => entry.component !== undefined);
  if (!entries.length) return groundSchedulingTemporal(previous, raw, source, timezone, now, waitingFor, operation, evidence, context, negativeContext);
  // C4: exclusions are proven once against EVERY affirmed quote; every grounding below reads the same proof.
  const { positive, excluded } = splitTemporalExclusions(evidence);
  const exclusions = excluded.length ? temporalExclusionsOf(source, positive, excluded, operation, timezone, now) : undefined;
  const owned = exclusions && source !== undefined ? ownedNegators(exclusions, source) : [];
  const ground = (fields: SchedulingFields, quotes: SchedulingTemporalEvidence) => exclusions
    ? groundWithExclusions(previous, fields, source, timezone, now, waitingFor, operation, quotes, context, negativeContext, exclusions)
    : groundSchedulingTemporal(previous, fields, source, timezone, now, waitingFor, operation, quotes, context, negativeContext);
  const verdicts = componentVerdicts(entries, source, raw, timezone, now, operation, context, waitingFor, owned, new Set(excluded.map(entry => entry.field)), previous,
    positive.filter(entry => entry.component === undefined && !entries.some(item => item.field === entry.field)));
  const roles = new Set<string>(verdicts.map(verdict => verdict.role));
  // The historical grammar reads the component roles with the values the components state.
  const shadowRaw: SchedulingFields = { ...raw };
  for (const verdict of verdicts) {
    if (verdict.shadow === undefined) continue;
    shadowRaw[verdict.role] = verdict.shadow;
    if (isDate(verdict.role)) for (const key of dateSelectors[verdict.role]) delete shadowRaw[key];
  }
  const plain = (keep: (role: string) => boolean) => positive.filter(entry => keep(entry.field)).map(({ component: _component, ...entry }) => { void _component; return entry; });
  const hasLegacy = (role: Role) => legacyValue(raw, role, timezone, now) !== undefined;
  if (!temporalComponentsEnabled()) {
    // Flag off: exactly the historical inputs decide (a component-only quote proves nothing).
    const effective = ground(raw, plain(role => !roles.has(role) || hasLegacy(role as Role)));
    try { report(ground(shadowRaw, plain(role => !roles.has(role) || verdicts.some(verdict => verdict.role === role && verdict.shadow !== undefined))), verdicts); } catch { /* shadow only */ }
    return effective;
  }
  const legacy = ground(shadowRaw, plain(role => !roles.has(role) || verdicts.some(verdict => verdict.role === role && (verdict.shadow !== undefined || hasLegacy(verdict.role)))));
  report(legacy, verdicts);
  const result: Grounded = { fields: { ...legacy.fields }, patch: { ...legacy.patch }, rejected: legacy.rejected.filter(item => !roles.has(item.field)),
    pending_temporal_ambiguities: legacy.pending_temporal_ambiguities.filter(item => !roles.has(item.field)),
    pending_calendar_conflicts: legacy.pending_calendar_conflicts.filter(item => !roles.has(item.field)) };
  // The dormant negative-context proof keeps its all-or-nothing contract.
  const negativeInvalid = negativeContext !== undefined && (source === undefined ||
    !validateTemporalNegativeContext(negativeContext, { source, previous, raw, evidence: plain(() => true), operation, now }).valid);
  // A short answer keeps its backend role: a whole-message component for another role is not accepted.
  const retarget = waitingFor !== undefined && ["date", "source_date", "end_date", "time", "source_time", "end_time"].includes(waitingFor) &&
    positive.length === 1 && verdicts.length === 1 && verdicts[0].role !== waitingFor && source !== undefined &&
    literalProofSpans(source, entries[0].text).some(([start, end]) => source.slice(0, start).trim() === "" && source.slice(end).replace(/[\s.!?,;]+/g, "") === "");
  const readings: PastReading[] = [], hints: LocatorHint[] = [], dayparts: DaypartResolution[] = [];
  const reject = (field: Role, code: TemporalRejection["code"], value: string) => {
    delete result.fields[field]; delete result.patch[field];
    if (!result.rejected.some(item => item.field === field)) result.rejected.push({ code, field, value: value.slice(0, 20) });
  };
  for (const verdict of verdicts) {
    const role = verdict.role;
    if (retarget) {
      for (const field of new Set<Role>([waitingFor as Role, role])) {
        reject(field, "SOURCE_TEMPORAL_CONFLICT", (field === role ? verdict.shadow : result.fields[field]) ?? "MISSING");
        if (field !== waitingFor && previous[field] !== undefined) { result.fields[field] = previous[field]; result.rejected.find(item => item.field === field)!.retained_value = previous[field]; }
      }
      continue;
    }
    if (verdict.code === "OK" && !negativeInvalid) {
      result.fields[role] = verdict.value; result.patch[role] = verdict.value;
      if (verdict.dropped && (role === "date" || role === "source_date")) readings.push({ field: role, date: verdict.value!, dropped: verdict.dropped, expression: verdict.expression! });
      if (verdict.resolved && (role === "time" || role === "end_time")) dayparts.push({ field: role, code: "DAYPART_RESOLVED_BY_INTERVAL", candidates: verdict.resolved, value: verdict.value!, expression: verdict.expression! });
      continue;
    }
    // B6 (flag): the origin said only in a negated predicate is neither a value nor asked; the locator checks it.
    if (verdict.code === "SOURCE_NEGATED_PREDICATE" && verdict.hint && !negativeInvalid) {
      delete result.patch[role]; if (result.fields[role] !== previous[role]) delete result.fields[role];
      hints.push({ field: "source_date", dates: verdict.hint, expression: verdict.expression!, ...(verdict.hintDropped ? { dropped: verdict.hintDropped } : {}) });
      continue;
    }
    reject(role, verdict.code === "DATE_IN_PAST" ? "DATE_IN_PAST" : "SOURCE_TEMPORAL_CONFLICT", verdict.code === "DATE_CHOICE" ? "AMBIGUOUS" : verdict.shadow ?? "MISSING");
    if (negativeInvalid || !verdict.pending) continue;
    if (verdict.pending.kind === "CLOCK_DAYPART") result.pending_temporal_ambiguities.push(verdict.pending);
    else result.pending_calendar_conflicts.push(verdict.pending as PendingCalendarConflict);
  }
  // A removed selector also invalidates a located appointment; a grammar-only doubt the
  // component proof resolved does not.
  if (result.rejected.length) delete result.fields.appointment_ref;
  else if (previous.appointment_ref !== undefined) result.fields.appointment_ref = previous.appointment_ref;
  // C4: a component value the same message excluded is refused like a legacy one.
  const grounded: GroundedTurn = exclusions ? { ...rejectExcludedValues(result, exclusions), exclusions } : result;
  if (readings.length) grounded.past_readings = readings.filter(item => grounded.fields[item.field] === item.date);
  if (hints.length) grounded.locator_hints = hints;
  const settled = dayparts.filter(item => grounded.fields[item.field] === item.value);
  if (settled.length) grounded.daypart_resolutions = settled;
  if (grounded.past_readings && !grounded.past_readings.length) delete grounded.past_readings;
  return grounded;
}
