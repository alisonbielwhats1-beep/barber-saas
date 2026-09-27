import { firstTemporalAmbiguity, temporalAmbiguityQuestion } from "./scheduling-temporal-ambiguity";
import { firstCalendarConflict, calendarConflictQuestion } from "./scheduling-calendar-conflict";
import { actionPlanPreview, conversationalClarifications, type ActionPlan, type PresentationHints, type ClarificationHint } from "@everflair/salon-secretary";
import type { SecretaryView } from "./salon-secretary";
import type { ActionUnit } from "./secretary-action-plan";
import { clarificationContext, candidateLabel } from "./secretary-clarification";

/** Read-only projection of adapter resolution. Hints never feed interpretation or drafts. */
export function presentationHints(plan: ActionPlan, units: readonly ActionUnit[], children: readonly { operation_ref: string; state: SecretaryView }[]): PresentationHints {
  const hints: Record<string, ClarificationHint> = {};
  for (const unit of units) {
    const view = children.find(child => child.operation_ref === unit.child)?.state;
    if (!view) continue;
    for (const key of unit.keys) {
      const action = plan.actions.find(a => a.key === key)!;
      const hint: ClarificationHint = { previewGroup: unit.child };
      const scheduling = view.scheduling ?? (action.operation === "appointment.cancel" ? view.communication?.cancel : undefined);
      if (scheduling) {
        if (scheduling.candidates) hint.selection = { field: scheduling.candidates.kind, labels: scheduling.candidates.items.map(item => item.name) };
        else if (scheduling.draft?.temporal_missing?.length || scheduling.draft?.source_missing?.length) hint.fields = [...(scheduling.draft.temporal_missing??[]),...(scheduling.draft.source_missing??[])];
        else if (scheduling.waiting_for) hint.fields = [scheduling.waiting_for];
        else hint.fields = action.missing_fields.filter(field => field !== "professional_ref" || !!scheduling.fields.service_ref || action.operation === "schedule.block");
      }
      const batchPick = view.batch?.draft?.candidates;
      if(view.batch?.draft?.review && action.operation==="appointment.create" && action.missing_fields.length)hint.question=view.batch.draft.message;
      // An unavailable slot is asked with the backend's own cause and real alternatives.
      if((scheduling?.draft?.review||/^(?:Esse horário|Não posso fazer encaixe)/.test(scheduling?.message??"")) && action.missing_fields.length)hint.question=scheduling!.message;
      if (batchPick?.item_key === key) hint.selection = { field: batchPick.field, labels: batchPick.items.map(item => item.name) };
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
      if(calendar){hint.fields=[calendar.field];hint.question=calendarConflictQuestion(calendar);delete hint.selection;}
      else if(residual){hint.fields=[residual.field];hint.question=temporalAmbiguityQuestion(residual);delete hint.selection;}
      else if(requested&&(pendingResiduals?.length||calendarConflicts?.length)){hint.fields=[requested];hint.question=scheduling?.message??view.batch?.draft?.message;delete hint.selection;}
      if (!scheduling && !view.batch) {
        const candidates = view.candidates ?? view.customer?.candidates ?? view.communication?.candidates ?? view.inventory?.candidates;
        if (candidates?.length) hint.selection = { field: action.skill === "services" ? "service_ref" : action.skill === "inventory" ? "product_name" : "customer_ref", labels: candidates.map(candidateLabel) };
        // These adapters deliberately resolve a prerequisite first.
        if (view.inventory && !hint.selection && action.missing_fields.includes("mode")) hint.fields = ["mode"];
        else if(view.inventory&&!hint.selection&&action.missing_fields.includes("quantity")){hint.fields=["quantity"];hint.question=view.inventory.message;}
        if (view.communication && !hint.selection && action.missing_fields.includes("channel")) hint.fields = ["channel"];
        if(view.customer?.lookup_issue){hint.fields=["target_name"];hint.question=view.customer.message;delete hint.selection;}
      }
      // Preserve concrete resolution failures, not adapter questions or architecture prose.
      const notice = view.message.split("\n")[0];
      if (/^(Não encontrei|Nenhum profissional|O profissional informado|O cliente não possui|O horário anterior|O final incompatível|Muitas opções|Muitos clientes|Possível cadastro)/.test(notice))
        hint.notice = notice.replace(/\s*(Informe|Escolha|Selecione|Confira)\b.*$/, "");
      hints[key] = hint;
    }
  }
  return hints;
}
export function secretaryPlanMessage(plan: ActionPlan, units: readonly ActionUnit[], children: readonly { operation_ref: string; state: SecretaryView }[]) {
  return actionPlanPreview(plan, presentationHints(plan, units, children));
}

/** The same questions drive both presentation and the next semantic turn. */
export function planConversationContext(plan: ActionPlan, units: readonly ActionUnit[], children: readonly {operation_ref:string;state:SecretaryView}[]) {
  const hints = presentationHints(plan, units, children);
  const questions = conversationalClarifications(plan, hints);
  return {plan_ref:plan.plan_ref, actions:plan.actions.map(action => {
    const hint=hints[action.key], question=questions.find(item=>item.action_key===action.key);
    const requested=hint?.selection?.field ?? (hint?.fields?.length===1 ? hint.fields[0] : undefined);
    const inventory=children.find(child=>units.some(unit=>unit.child===child.operation_ref&&unit.keys.includes(action.key)))?.state.inventory;
    return {item_key:action.key, status:action.status, depends_on:action.depends_on,
      ...(inventory?{quantity_context:{catalog_unit:inventory.draft?.product.unit??"un",resolution:inventory.quantity_resolution}}:{}),
      ...clarificationContext({operation:action.operation,fields:action.fields,missing_fields:action.missing_fields,
        waiting_for:requested,selection:hint?.selection,message:question?.question??action.assessment.preview??"",pending_temporal_ambiguities:action.assessment.pending_temporal_ambiguities,pending_calendar_conflicts:action.assessment.pending_calendar_conflicts})};
  })};
}
