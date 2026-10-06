import { runServicesTurn, type Model, type CustomerInterpretation } from "@everflair/salon-secretary";
import { clarificationContext, candidateLabel } from "./secretary-clarification";
import { applyDraftTransition } from "./secretary-draft-transition";
import { sameAcceptedQuery } from "./secretary-entity-context";
import { sameName } from "./name-search";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { getOperationRequirements } from "./service-contract";
import { customerPatch, customerReadField, customerReadProjection, type CustomerReadField, type CustomerPatch, type CustomerDTO } from "./customer-contract";
import { searchSalonCustomer, getCustomer, customerDuplicates } from "./customer-catalog";
import { upsertCustomerDraft, proposeCustomerChange, confirmCustomerChange } from "./customer-actions";
import { detailQuestion, nameSuggestionsEnabled, suggestedRows, suggestionQuestion, suggestSalonCustomers } from "./entity-suggestions";

export type CustomerState = {
  operation?: "customer.search" | "customer.read" | "customer.create" | "customer.change";
  query?: string; target?: string; patch: CustomerPatch; requested: ("name"|"phone"|"email")[]; read_fields?: CustomerReadField[];
  lookup_issue?: "INVALID_EMAIL_REFERENCE";
  /** `suggested` (C3, flag): the candidates are tolerant suggestions after an empty search; the same function rechecks a click.
   * `selected_name` (B4): name of the candidate the owner chose; its later echo is not a new target. */
  candidates?: Awaited<ReturnType<typeof searchSalonCustomer>>; duplicate?: boolean; suggested?: boolean; selected_name?: string;
  draft?: Awaited<ReturnType<typeof upsertCustomerDraft>>; proposal?: Awaited<ReturnType<typeof proposeCustomerChange>>;
  receipt?: Awaited<ReturnType<typeof confirmCustomerChange>>; customer?: CustomerDTO; message: string;
};
export function customerState(): CustomerState { return { patch: {}, requested: [], message: "Posso buscar, consultar, cadastrar ou alterar nome, telefone e e-mail de clientes. Foto desabilitada." }; }
const labels = { name: "nome", phone: "telefone", email: "e-mail" };
async function prepare(actor: ServiceActor, c: CustomerState) {
  if (c.operation !== "customer.create" && c.operation !== "customer.change") throw new Error("OPERATION_MISMATCH");
  c.draft = await withTenant(actor, tx => upsertCustomerDraft(tx, actor, { operation: c.operation,
    ...(c.draft ? { draft_ref: c.draft.draft_ref, expected_revision: c.draft.draft_revision } : {}),
    ...(c.target ? { customer_ref: c.target } : {}), patch: c.patch, requested_fields: c.requested }));
  const duplicates = await withTenant(actor, tx => customerDuplicates(tx, actor, c.draft!.fields, c.target));
  if (duplicates.length) {
    c.duplicate = true; c.candidates = duplicates.slice(0,20);
    c.message = "Possível cadastro correspondente. Selecione para consultar o existente ou cancele e revise os dados. Nenhum cliente foi criado ou alterado."; return;
  }
  c.duplicate = false; c.candidates = undefined;
  if (c.draft.status !== "READY") {
    c.message = c.draft.missing_fields.length ? `Informe ${c.draft.missing_fields.map(k=>labels[k]).join(" e ")}.` : "Informe o campo e o novo valor que deseja alterar."; return;
  }
  c.proposal = await withTenant(actor, tx => proposeCustomerChange(tx, actor, { draft_ref: c.draft!.draft_ref, draft_revision: c.draft!.draft_revision }));
  c.message = `Confira o ${c.operation === "customer.create" ? "cadastro" : "ajuste"} do cliente:\n${c.proposal.preview}\nUse Confirmar para executar.`;
}
async function resolved(actor: ServiceActor, c: CustomerState) {
  if (!c.target) throw new Error("CUSTOMER_NOT_FOUND");
  if (c.operation === "customer.search" || c.operation === "customer.read") {
    c.customer = await withTenant(actor, tx=>getCustomer(tx, actor, c.target!));
    const fields = c.read_fields?.length ? c.read_fields : customerReadField.options;
    c.message = fields.map(field => labels[field][0].toUpperCase()+labels[field].slice(1)+": "+(c.customer![field] ?? "Não informado")).join("\n");
  } else await prepare(actor, c);
}
async function selectCustomerMutable(actor: ServiceActor, c: CustomerState, ref: string) {
  if (!c.candidates?.some(x=>x.id===ref)) throw new Error("SELECTION_INVALID");
  const fresh = c.duplicate
    ? await withTenant(actor,tx=>customerDuplicates(tx,actor,c.draft!.fields,c.target))
    : c.suggested ? suggestedRows(await withTenant(actor,tx=>suggestSalonCustomers(tx,actor,c.query!)))
    : await withTenant(actor,tx=>searchSalonCustomer(tx,actor,c.query!));
  if (!fresh.some(x=>x.id===ref)) throw new Error("SELECTION_INVALID");
  if (c.suggested) c.suggested = undefined;
  if (c.duplicate) { // Explicit decision only opens the existing profile. Never merges or authorizes the pending patch.
    c.operation = "customer.read"; c.patch = {}; c.requested = []; c.read_fields = undefined; c.draft = undefined; c.proposal = undefined; c.duplicate = false;
  }
  c.selected_name = c.candidates?.find(x=>x.id===ref)?.name;
  c.target = ref; c.candidates = undefined; await resolved(actor,c);
}
export async function selectCustomer(actor:ServiceActor,c:CustomerState,ref:string){
  return applyDraftTransition(c,next=>selectCustomerMutable(actor,next,ref));
}
export async function sendCustomerTurn(actor: ServiceActor, c: CustomerState, model: Model, message: string, assertLive: () => unknown = () => undefined) {
  c.proposal = undefined; c.customer = undefined;
  const result = await runServicesTurn(model,message,{ ...clarificationContext({operation:c.operation,fields:{...c.patch,target_name:c.query},missing_fields:c.draft?.missing_fields,...(c.lookup_issue?{waiting_for:"target_name"}:c.candidates?.length?{waiting_for:"customer_ref",selection:{field:"customer_ref",labels:c.candidates.map(candidateLabel)}}:{}),message:c.message}), target_selected: Boolean(c.target), requested_fields: c.operation === "customer.read" || c.operation === "customer.search" ? c.read_fields ?? [] : c.requested },
    { create: getOperationRequirements("customer.create"), change: getOperationRequirements("customer.change") },"customers");
  assertLive(); // Session may have expired while waiting for the provider: no draft writes afterward.
  return applyCustomerInterpretation(actor, c, result);
}
async function applyCustomerInterpretationMutable(actor: ServiceActor, c: CustomerState, result: CustomerInterpretation) {
  c.proposal = undefined; c.customer = undefined; c.lookup_issue=undefined;
  const { operation = c.operation, target_name, requested_fields = [], clear_fields = [], ...values } = result;
  if (!operation) { c.message = "Informe se deseja consultar, cadastrar ou alterar um cliente."; return; }
  if (c.operation && c.operation !== operation) throw new Error("OPERATION_MISMATCH");
  // B4: echoing the chosen candidate's own name ("Amanda Souza" after the query "Amanda") keeps that target.
  const echo = !!c.target && !!target_name && !sameAcceptedQuery(target_name,c.query) && !!c.selected_name && sameName(target_name,c.selected_name);
  if (c.target && target_name && !sameAcceptedQuery(target_name,c.query) && !echo) throw new Error("TARGET_ALREADY_SELECTED");
  if (operation === "customer.create" && target_name) throw new Error("OPERATION_MISMATCH");
  for (const field of clear_fields) if (values[field] !== undefined) throw new Error("CONTRADICTORY_PATCH");
  const patch = customerPatch.parse({ ...values, ...Object.fromEntries(clear_fields.map(k=>[k,null])) });
  const reading = operation === "customer.search" || operation === "customer.read";
  if (reading && (Object.keys(patch).length || clear_fields.length)) throw new Error("OPERATION_MISMATCH");
  const readFields = reading ? customerReadProjection.parse(requested_fields) : undefined;
  c.operation = operation; c.patch = customerPatch.parse({ ...c.patch,...patch });
  if (reading) {
    // Keep the accepted projection while resolving a missing/ambiguous target.
    // These field names never enter the mutation mask or prepare().
    if (readFields!.length) c.read_fields = readFields;
    c.requested = [];
  } else c.requested = [...new Set([...c.requested,...requested_fields])];
  if (!echo) c.query = target_name ?? c.query;
  if (operation === "customer.create") { await prepare(actor,c); return; }
  if (c.target) { await resolved(actor,c); return; }
  if (!c.query) { c.message = "Qual é o nome ou telefone do cliente?"; return; }
  let candidates:Awaited<ReturnType<typeof searchSalonCustomer>>;
  try{candidates=await withTenant(actor, tx=>searchSalonCustomer(tx,actor,c.query!));}
  catch(error){
    if(!(error instanceof Error)||error.message!=="INVALID_EMAIL_REFERENCE")throw error;
    c.candidates=undefined;c.lookup_issue="INVALID_EMAIL_REFERENCE";
    c.message="O e-mail informado está incompleto ou inválido. Qual é o e-mail completo do cliente?";return;
  }
  if (c.suggested) c.suggested = undefined;
  if (!candidates.length && nameSuggestionsEnabled()) {
    const found = await withTenant(actor, tx=>suggestSalonCustomers(tx,actor,c.query!));
    if (found.status === "SUGGEST") { c.candidates = found.rows; c.suggested = true; c.message = suggestionQuestion(c.query, found.rows.map(candidateLabel)); return; }
    if (found.status !== "NONE") { c.candidates = undefined; c.message = detailQuestion(c.query, "cliente"); return; }
  }
  if (candidates.length !== 1) {
    c.candidates = candidates.length <= 20 ? candidates : undefined;
    c.message = !candidates.length ? "Não encontrei esse cliente neste salão." : candidates.length > 20 ? "Muitos clientes encontrados. Informe um nome mais específico." : "Encontrei mais de um cliente. Selecione qual deseja."; return;
  }
  c.target = candidates[0].id; c.candidates=undefined; await resolved(actor,c);
}
export async function applyCustomerInterpretation(actor:ServiceActor,c:CustomerState,result:CustomerInterpretation){
  return applyDraftTransition(c,next=>applyCustomerInterpretationMutable(actor,next,result));
}
