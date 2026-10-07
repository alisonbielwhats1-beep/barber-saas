import { firstTemporalAmbiguity, temporalAmbiguityQuestion } from "./scheduling-temporal-ambiguity";
import { firstCalendarConflict, calendarConflictQuestion } from "./scheduling-calendar-conflict";
import { actionPlanPreview, conversationalClarifications, terminalActionStatus, type ActionPlan, type PresentationHints, type ClarificationHint } from "@everflair/salon-secretary";
import type { SecretaryView } from "./salon-secretary";
import type { ActionUnit } from "./secretary-action-plan";
import { clarificationContext, candidateLabel } from "./secretary-clarification";
import { hintOptions, type PublishedOption } from "./secretary-options";
import { resolvedSubject } from "./secretary-display";
import { daypartRulesV2Enabled } from "./scheduling-temporal-reference";
import { isServiceListField, isSingleComboQuestion, severalProfessionalsQuestion } from "./secretary-multi-service";
import { schedulingServiceRefs } from "./scheduling-contract";
import { recurrenceNotice, recurrencePending, RECURRENCE_CARD } from "./secretary-recurrence";
import { seriesSupports } from "./secretary-series";
import { BLOCK_OVERLAP_CARD } from "./secretary-block-guard";
/** P2a: the fields and cards of an alteration question (secretary-alteration.ts). */
const alterationQuestions = new Set(["target_professional_name", "service_changes", "target_professional_ref", "service_changes_ref"]);
const isAlterationField = (field?: string) => !!field && alterationQuestions.has(field);

/** Read-only projection of adapter resolution. Hints never feed interpretation or drafts. */
export function presentationHints(plan: ActionPlan, units: readonly ActionUnit[], children: readonly { operation_ref: string; state: SecretaryView }[]): PresentationHints {
  const hints: Record<string, ClarificationHint> = {}, recurrenceNotices = new Set<string>();
  for (const unit of units) {
    const view = children.find(child => child.operation_ref === unit.child)?.state;
    if (!view) continue;
    for (const key of unit.keys) {
      const action = plan.actions.find(a => a.key === key)!;
      const hint: ClarificationHint = { previewGroup: unit.child };
      const scheduling = view.scheduling ?? (action.operation === "appointment.cancel" ? view.communication?.cancel : undefined);
      if (scheduling) {
        if (scheduling.candidates) hint.selection = { field: scheduling.candidates.kind, labels: scheduling.candidates.items.map(item => item.name), refs: scheduling.candidates.items.map(item => item.id) };
        else if (scheduling.draft?.temporal_missing?.length || scheduling.draft?.source_missing?.length) hint.fields = [...(scheduling.draft.temporal_missing??[]),...(scheduling.draft.source_missing??[])];
        else if (scheduling.waiting_for) hint.fields = [scheduling.waiting_for];
        else hint.fields = action.missing_fields.filter(field => field !== "professional_ref" || !!schedulingServiceRefs(scheduling.fields) || action.operation === "schedule.block");
      }
      // C3 option cards (suggestions / a model name to confirm) ask with the adapter's own question.
      if (scheduling?.candidates?.source) hint.question = scheduling.message;
      const batchPick = view.batch?.draft?.candidates;
      if(view.batch?.draft?.review && action.operation==="appointment.create" && action.missing_fields.length)hint.question=view.batch.draft.message;
      // An unavailable slot is asked with the backend's own cause and real alternatives.
      if((scheduling?.draft?.review||/^(?:Esse horário|Não posso fazer encaixe)/.test(scheduling?.message??"")) && action.missing_fields.length)hint.question=scheduling!.message;
      // P2a: an alteration question (a name to resolve, a refused service delta, who performs every service) is the adapter's own.
      const alterationQuestion=!!scheduling&&(isAlterationField(scheduling.waiting_for)||isAlterationField(scheduling.candidates?.kind))&&action.missing_fields.length>0;
      if(alterationQuestion)hint.question=scheduling!.message;
      // P2b: a service-list question (a service to resolve, a catalog combo, two professionals named) is the adapter's own too.
      const serviceListQuestion=!!scheduling&&(isServiceListField(scheduling.waiting_for)||isServiceListField(scheduling.candidates?.kind)||!!scheduling.fields?.service_names&&scheduling.message?.startsWith(severalProfessionalsQuestion)===true)&&action.missing_fields.length>0;
      if(serviceListQuestion)hint.question=scheduling!.message;
      // FX6 (owner rule 9): the one-combo card of a single-service path says why (the adapter's own text).
      if(scheduling?.candidates?.kind==="service_ref"&&isSingleComboQuestion(scheduling.message)&&action.missing_fields.length)hint.question=scheduling.message;
      // P3b (flag SALON_SECRETARY_READS_V2): a day summarized above the list limit asks with its own counts (the adapter's text).
      if(scheduling?.read_partial==="SUMMARY"&&action.missing_fields.length)hint.question=scheduling.message;
      // P3c (flag SALON_SECRETARY_RECURRENCE_GUARD): the one-option "só a primeira?" card asks with the adapter's own text.
      if(scheduling?.candidates?.kind===RECURRENCE_CARD&&action.missing_fields.length)hint.question=scheduling.message;
      // C5 (flag SALON_SECRETARY_BLOCK_OVERLAP_GUARD): the block-over-appointments card asks with the adapter's own text (who is inside).
      if(scheduling?.candidates?.kind===BLOCK_OVERLAP_CARD&&action.missing_fields.length)hint.question=scheduling.message;
      if (batchPick?.item_key === key) hint.selection = { field: batchPick.field, labels: batchPick.items.map(item => item.name), refs: batchPick.items.map(item => item.id) };
      if (batchPick?.item_key === key && (batchPick.source || isSingleComboQuestion(view.batch!.draft!.message))) hint.question = view.batch!.draft!.message;
      const batchItem=view.batch?.draft?.plan.items.find(item=>item.key===key);
      const evidenceMissing=[...(scheduling?.draft?.temporal_missing??batchItem?.temporal_missing??[]),...(scheduling?.draft?.source_missing??batchItem?.source_missing??[])];
      if(evidenceMissing.length){
        // Entity lookup cannot finish until these factual inputs are reconciled.
        // Ask about the actual rejected role rather than an unresolved downstream ref.
        hint.fields=evidenceMissing;delete hint.selection;delete hint.question;
      }
      const pendingResiduals=action.assessment.pending_temporal_ambiguities??scheduling?.pending_temporal_ambiguities??scheduling?.draft?.pending_temporal_ambiguities??batchItem?.pending_temporal_ambiguities;
      const calendarConflicts=action.assessment.pending_calendar_conflicts??scheduling?.pending_calendar_conflicts??scheduling?.draft?.pending_calendar_conflicts??batchItem?.pending_calendar_conflicts;
      const batchRequested=view.batch?.draft?.missing_fields.length===1&&view.batch.draft.missing_fields[0].startsWith(key+".")?view.batch.draft.missing_fields[0].slice(key.length+1):undefined;
      const requested=scheduling?.waiting_for??batchRequested;
      // The adapter selects the pending question. Presentation must not replace
      // a prerequisite such as an exact cancellation reason with a later clock.
      const residual=requested?pendingResiduals?.find(item=>item.field===requested):firstTemporalAmbiguity(pendingResiduals);
      const calendar=requested?calendarConflicts?.find(item=>item.field===requested):firstCalendarConflict(calendarConflicts);
      // UX-COPY (flag): the role is named by what this action does with it (a cancellation's own time, a block's start).
      if(calendar){hint.fields=[calendar.field];hint.question=calendarConflictQuestion(calendar,action.operation);delete hint.selection;}
      else if(residual){hint.fields=[residual.field];hint.question=temporalAmbiguityQuestion(residual,action.operation);delete hint.selection;}
      else if(requested&&(pendingResiduals?.length||calendarConflicts?.length)){hint.fields=[requested];hint.question=scheduling?.message??view.batch?.draft?.message;delete hint.selection;}
      if (!scheduling && !view.batch) {
        const candidates = view.candidates ?? view.customer?.candidates ?? view.communication?.candidates ?? view.inventory?.candidates;
        if (candidates?.length) hint.selection = { field: action.skill === "services" ? "service_ref" : action.skill === "inventory" ? "product_name" : "customer_ref", labels: candidates.map(candidateLabel), refs: candidates.map(candidate => candidate.id) };
        // These adapters deliberately resolve a prerequisite first.
        if (view.inventory && !hint.selection && action.missing_fields.includes("mode")) hint.fields = ["mode"];
        else if(view.inventory&&!hint.selection&&action.missing_fields.includes("quantity")){hint.fields=["quantity"];hint.question=view.inventory.message;}
        if (view.communication && !hint.selection && action.missing_fields.includes("channel")) hint.fields = ["channel"];
        if(view.customer?.lookup_issue){hint.fields=["target_name"];hint.question=view.customer.message;delete hint.selection;}
        if(view.customer?.suggested&&hint.selection)hint.question=view.customer.message;
      }
      // Preserve concrete resolution failures, not adapter questions or architecture prose.
      // A C3 option card already is the question: its "Não encontrei" line is not repeated as a notice.
      const notice = view.message.split("\n")[0];
      const optionCard = Boolean(scheduling?.candidates?.source || view.customer?.suggested || (batchPick?.item_key === key && batchPick.source));
      // C1 (flag SALON_SECRETARY_DAYPART_RULES_V2): an answer that was not applied is said, never a silent identical re-ask.
      if (!optionCard && !alterationQuestion && !serviceListQuestion && (/^(Não encontrei|Nenhum profissional|O profissional informado|O cliente não possui|O horário anterior|O final incompatível|Muitas opções|Muitos clientes|Possível cadastro|Não consegui confirmar o serviço)/.test(notice) ||
        daypartRulesV2Enabled() && /^Não consegui associar essa resposta/.test(notice)))
        hint.notice = notice.replace(/\s*(Informe|Escolha|Selecione|Confira)\b.*$/, "");
      // P3c: while a stated recurrence owes the owner's yes, the questions before its card say it is not supported (once: not when the
      // backend already said it, owner 07/10; never when the series supports it, flag SALON_SECRETARY_RECURRING_SERIES).
      if (!hint.notice && scheduling && scheduling.candidates?.kind !== RECURRENCE_CARD && action.missing_fields.length && recurrencePending(scheduling.recurrence, action.operation) &&
        (!scheduling.recurrence!.noticed || scheduling.recurrence!.noticed_rev === scheduling.draft?.draft_revision) && !seriesSupports(action.operation, scheduling.recurrence!.expression)) {
        hint.notice = recurrenceNotice(action.operation, scheduling.recurrence!.expression); recurrenceNotices.add(key); }
      // C5: an action that only waits for another action's value is a note (never a question); a contradicted reference is said.
      const references = view.scheduling?.references ?? (action.operation === "customer.message" ? view.communication?.references : undefined);
      if (references?.blocked && references.note) { hint.waiting = references.note; delete hint.fields; delete hint.question; delete hint.selection; }
      if (references?.notice && action.missing_fields.length) hint.notice = references.notice;
      // B7: sentences name the subject as the salon registered it once resolved ("Fábio Santos", not "fabio").
      const subject = resolvedSubject(action, view);
      if (subject) hint.subject = subject;
      hints[key] = hint;
    }
  }
  // Review B (P3c): a recurrence notice said above the questions is not repeated when another action's own "só a primeira?"
  // question already says it word for word (the plan shows it once).
  for (const key of recurrenceNotices) if (Object.entries(hints).some(([other, hint]) => other !== key && hint.question?.includes(hints[key].notice!))) delete hints[key].notice;
  return hints;
}
export function secretaryPlanMessage(plan: ActionPlan, units: readonly ActionUnit[], children: readonly { operation_ref: string; state: SecretaryView }[]) {
  return actionPlanPreview(plan, presentationHints(plan, units, children));
}

/** B4: every open action's card as published options with their backend refs (the binding a choice
 * by id resolves through). Refs stay here: Luna and the screen only ever see option ids and labels. */
export function planOptions(plan: ActionPlan, units: readonly ActionUnit[], children: readonly { operation_ref: string; state: SecretaryView }[]): Record<string, PublishedOption[]> {
  const options = hintOptions(presentationHints(plan, units, children));
  for (const action of plan.actions) if (terminalActionStatus(action.status)) delete options[action.key];
  return options;
}

/** The same questions drive both presentation and the next semantic turn. `attempt` (B6, active plan only): turns in a
 * row a question was asked, published as clarification.repeat_count when it is a repeat. */
export function planConversationContext(plan: ActionPlan, units: readonly ActionUnit[], children: readonly {operation_ref:string;state:SecretaryView}[],
  attempt?: (question: { action_key: string; fields: readonly string[]; question: string }) => number) {
  const hints = presentationHints(plan, units, children);
  const questions = conversationalClarifications(plan, hints);
  // B7: the screen names resolved subjects; Luna's context keeps the wording of the owner's own names (unchanged input).
  const said = conversationalClarifications(plan, Object.fromEntries(Object.entries(hints).map(([key, value]) => { const { subject, ...hint } = value; void subject; return [key, hint] as const; })));
  return {plan_ref:plan.plan_ref, actions:plan.actions.map(action => {
    // A discarded action keeps only its identity (its key stays taken); nothing of it is open to answer.
    if(action.status==="DISCARDED")return {item_key:action.key,status:action.status,depends_on:action.depends_on,...clarificationContext({operation:action.operation,fields:{},message:""})};
    const hint=hints[action.key], question=questions.find(item=>item.action_key===action.key), asked=said.find(item=>item.action_key===action.key);
    const requested=hint?.selection?.field ?? (hint?.fields?.length===1 ? hint.fields[0] : undefined);
    const inventory=children.find(child=>units.some(unit=>unit.child===child.operation_ref&&unit.keys.includes(action.key)))?.state.inventory;
    return {item_key:action.key, status:action.status, depends_on:action.depends_on,
      ...(inventory?{quantity_context:{catalog_unit:inventory.draft?.product.unit??"un",resolution:inventory.quantity_resolution}}:{}),
      ...clarificationContext({operation:action.operation,fields:action.fields,missing_fields:action.missing_fields,
        waiting_for:requested,selection:hint?.selection,message:asked?.question??action.assessment.preview??"",pending_temporal_ambiguities:action.assessment.pending_temporal_ambiguities,pending_calendar_conflicts:action.assessment.pending_calendar_conflicts,
        ...(question&&attempt?{repeat_count:attempt(question)}:{})})};
  })};
}
