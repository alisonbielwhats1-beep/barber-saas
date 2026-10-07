import { proposalHasExpired, expiredProposalMessage } from './secretary-proposal-lifetime';
import type { PlanAction } from '@everflair/salon-secretary';
import type { SecretaryView } from './salon-secretary';
import { formatLocalRange } from './secretary-datetime-format';
import type { DictationSuggestion } from './secretary-voice-correction';
import { existingBookingNotice, resolvedSubject, suggestedTextLabel } from './secretary-display';

export const operationLabels: Record<string, string> = {
  'service.create': 'Cadastrar serviço', 'service.change': 'Alterar serviço',
  'customer.create': 'Cadastrar cliente', 'customer.change': 'Alterar cliente',
  'customer.search': 'Encontrar cliente', 'customer.read': 'Consultar cliente',
  'appointment.create': 'Agendar', 'appointment.change': 'Mudar horário',
  'appointment.cancel': 'Cancelar agendamento', 'appointment.list': 'Consultar agenda',
  'appointment.read': 'Consultar agendamento', 'availability.get': 'Consultar horários',
  'schedule.block': 'Bloquear horário', 'stock.movement': 'Movimentar estoque',
  'stock.balance': 'Consultar estoque', 'product.search': 'Encontrar produto',
  'financial.report': 'Consultar financeiro', 'customer.message': 'Preparar mensagem',
};
export const statusLabels: Record<string, string> = {
  DONE: 'Concluído', READY_FOR_CONFIRMATION: 'Aguardando confirmação', READY: 'Em preparação',
  NEEDS_INPUT: 'Preciso de uma informação', BLOCKED_BY_DEPENDENCY: 'Aguarda a ação anterior',
  DOMAIN_CONFLICT: 'Revisão necessária', UNSUPPORTED: 'Não disponível', FAILED_SAFE: 'Não concluído', DISCARDED: 'Descartada',
};
export const rawProposalOf = (view: SecretaryView) => view.proposal ?? view.customer?.proposal ?? view.scheduling?.proposal ?? view.inventory?.proposal ?? view.batch?.proposal ?? view.communication?.proposal;
export const proposalExpired = (view: SecretaryView,now=Date.now()) => !receiptOf(view) && (view.proposal_expired===true || proposalHasExpired(rawProposalOf(view),now));
export const proposalOf = (view: SecretaryView,now=Date.now()) => proposalExpired(view,now) ? undefined : rawProposalOf(view);
export const receiptOf = (view: SecretaryView) => view.receipt ?? view.customer?.receipt ?? view.scheduling?.receipt ?? view.inventory?.receipt ?? view.batch?.receipt ?? view.communication?.receipt;
export const hasReceipt = (view: SecretaryView) => Boolean(receiptOf(view) || view.operations?.some(operation => receiptOf(operation.state)));
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);

/** Presentation only. Never render identifiers or architecture prose as a result. */
export function humanMessage(text: string) {
  return text.replace(/(?:Referência|Recibo|Resultado verificado):?\s*[^\s.]+\.?/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '')
    .replace(/\bc[a-z0-9]{24,}\b/g, '')
    .replace(/\b(?:service_ref|customer_ref|professional_ref|appointment_ref|override_reason|override_requested|destination_mode|action_key)\b/g, 'informação')
    .replace(/\b(?:SLOT_CONFLICT|SLOT_TAKEN)\b/g, 'horário indisponível')
    .replace(/\bCONFLICT_HARD_BLOCK\b/g, 'horário bloqueado')
    .replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, 'revisão necessária').trim();
}
export function candidatesOf(view: SecretaryView) {
  if (view.candidates) return view.candidates.map(c => ({ id: c.id, label: `${c.name} · ${c.durationMin} min · ${money(c.priceCents)}` }));
  const customers = view.customer?.candidates ?? view.communication?.candidates;
  if (customers) return customers.map(c => ({ id: c.id, label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}` }));
  if (view.inventory?.candidates) return view.inventory.candidates.map(c => ({ id: c.id, label: `${c.name} · ${c.stock} un${c.active ? '' : ' · inativo'}` }));
  return (view.batch?.draft?.candidates?.items ?? view.scheduling?.candidates?.items ?? view.communication?.cancel?.candidates?.items ?? [])
    .map(c => ({ id: c.id, label: c.name }));
}
export function reviewOf(view?: SecretaryView) { return view?.batch?.draft?.review ?? view?.scheduling?.draft?.review; }
/** UX-COPY (flag SALON_SECRETARY_COPY_V2, told by the server as `copyV2`): the review box heading comes from the backend's status
 * and never from the mere presence of a review. AVAILABLE has no box (the proposal already says what will be booked); an unknown
 * status gets a neutral heading, never "disponível". Off (`copyV2` false): the historical two-way heading. Display only: a
 * HARD_BLOCK still never offers Confirmar (that gate is the backend's and the plan's, not this text). */
export function reviewHeading(status: string, copyV2 = false): string | undefined {
  if (!copyV2) return status === 'CONFLICT_HARD_BLOCK' ? 'Este horário não pode ser usado' : 'Atenção ao horário';
  return status === 'AVAILABLE' ? undefined : status === 'CONFLICT_HARD_BLOCK' ? 'Este horário não pode ser usado' : status === 'CONFLICT_OVERRIDABLE' ? 'Horário com conflito' : 'Revise este horário';
}
export function viewForAction(root: SecretaryView, action: PlanAction) {
  return root.operations?.find(operation => operation.action_keys?.includes(action.key));
}
export function actionEntity(action: PlanAction) {
  const f = action.fields;
  const scheduling = f as Record<string, unknown>;
  return (typeof scheduling.customer_name === 'string' ? scheduling.customer_name : undefined) ?? f.target_name ?? f.name ?? f.inventory?.product_name ?? f.communication?.recipient_name ?? (typeof scheduling.service_name === 'string' ? scheduling.service_name : '');
}
/** B7: the subject as the salon registered it once the backend resolved it ("Fábio Santos"), else the owner's words. */
export function actionSubject(action: PlanAction, root?: SecretaryView) {
  return (root && resolvedSubject(action, viewForAction(root, action)?.state)) || actionEntity(action);
}
/** P2a: a change that alters who attends or the services (data-driven: flag off, these fields never exist). */
const alters = (operation: string | undefined, fields: unknown) => {
  const f = (fields ?? {}) as Record<string, unknown>;
  return operation === 'appointment.change' && (f.target_professional_name != null || f.target_professional_ref != null || f.service_changes != null);
};
/** The action's heading: "Alterar agendamento" for a change of who attends or of services (said, held by the adapter, or the service
 * still being asked: owner 07/10, "Altere o serviço da Adriana" showed "Mudar horário"), else the operation's label. */
export function actionHeading(action: PlanAction, root?: SecretaryView) {
  const scheduling = root ? viewForAction(root, action)?.state?.scheduling : undefined;
  const altering = alters(action.operation, action.fields) || action.operation === 'appointment.change' && !!scheduling &&
    (alters(action.operation, scheduling.fields) || scheduling.waiting_for === 'service_changes' || scheduling.waiting_for === 'target_professional_name');
  return altering ? 'Alterar agendamento' : operationLabels[action.operation] ?? 'Ação';
}
export function actionTitle(action: PlanAction, root?: SecretaryView) {
  const subject = actionSubject(action, root);
  return `${actionHeading(action, root)}${subject ? ` — ${subject}` : ''}`;
}
/** B7 timeline: one read-only line per action of a plan ("Mudar horário — Fábio Santos: aguardando confirmação"). */
export function planSummary(plan: { actions: readonly PlanAction[] }, root?: SecretaryView) {
  return plan.actions.map(item => `${actionTitle(item, root)}: ${item.status === 'DONE' ? 'concluída' : (statusLabels[item.status] ?? 'não concluída').toLowerCase()}`);
}
/** Review 2b: open actions that would go with a discard of `key` (the same operation card's other actions and,
 * transitively, their dependents): the backend's closure, shown to the owner before a one-tap discard. */
export function linkedDiscard(view: SecretaryView, key: string): string[] {
  const plan = view.action_plan;
  if (!plan) return [];
  const open = (item: string) => !['DONE', 'DISCARDED'].includes(plan.actions.find(action => action.key === item)?.status ?? 'DONE');
  const targets = new Set([key]);
  for (let grown = true; grown;) {
    grown = false;
    const add = (item: string) => { if (!targets.has(item) && open(item)) { targets.add(item); grown = true; } };
    for (const operation of view.operations ?? []) if (operation.action_keys?.some(item => targets.has(item))) operation.action_keys.forEach(add);
    for (const action of plan.actions) if (action.depends_on.some(item => targets.has(item))) add(action.key);
  }
  return plan.execution_order.filter(item => item !== key && targets.has(item));
}
const confirmationNouns: Record<string, [string, string]> = {
  'appointment.create': ['agendamento', ' de '], 'appointment.change': ['remarcação', ' de '], 'appointment.cancel': ['cancelamento', ' de '],
  'schedule.block': ['bloqueio', ' de '], 'service.create': ['cadastro do serviço', ' '], 'service.change': ['alteração do serviço', ' '],
  'customer.create': ['cadastro', ' de '], 'customer.change': ['alteração do cadastro', ' de '], 'customer.message': ['mensagem', ' para '],
  'stock.movement': ['movimentação de estoque', ' de '],
};
/** "remarcação de Fábio", "bloqueio de Rodrigo": what one confirmation executes (same wording as the backend). */
export function confirmationLabel(actions: readonly PlanAction[], root?: SecretaryView) {
  const items = actions.filter(action => action.mutation && action.status !== 'DONE' && action.status !== 'DISCARDED').map(action => {
    const [noun, link] = alters(action.operation, action.fields) ? ['alteração do agendamento', ' de '] : confirmationNouns[action.operation] ?? [(operationLabels[action.operation] ?? 'ação').toLowerCase(), ' — '];
    const professional = (action.fields as Record<string, unknown>).professional_name;
    const resolved = root ? resolvedSubject(action, viewForAction(root, action)?.state) : undefined;
    const subject = resolved ?? (action.operation === 'schedule.block' ? typeof professional === 'string' ? professional : '' : actionEntity(action));
    return `${noun}${subject ? `${link}${subject}` : ''}`;
  });
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}
/** `reference` (B7): the server's local date for the salon (view.today); dates of another year show it. `released` (C7,
 * review): appointments another action of the same plan cancels or moves (planReleasedAppointments). */
export function actionDetails(view: SecretaryView | undefined, action?: PlanAction, reference?: string, released?: ReadonlySet<string>) {
  if (!view) return humanMessage(action?.assessment.preview ?? '');
  if(proposalExpired(view))return expiredProposalMessage;
  if (view.receipt?.service) {
    const before = view.proposal?.change?.before;
    const after = view.receipt.service;
    return `${after.name}\n${before ? `${money(before.priceCents)} → ` : ''}${money(after.priceCents)} · ${after.durationMin} min`;
  }
  if (view.inventory?.receipt) {
    const inventory = view.inventory;
    return `${inventory.proposal?.product.name ?? inventory.query ?? 'Estoque'}\n${inventory.proposal ? `${inventory.proposal.product.stock} → ` : ''}${inventory.receipt!.stock} un`;
  }
  if (view.customer?.receipt) return `${view.customer.receipt.customer.name}\nCadastro atualizado.`;
  if (view.scheduling?.receipt) {
    const receipt = view.scheduling.receipt, snapshot = receipt.action_snapshot ?? receipt.snapshot;
    const title = receipt.outcome === 'PENDING_ACCEPTANCE' ? 'Solicitação registrada. Aguarda aceite do cliente.'
      : receipt.outcome === 'CANCELLED' ? 'Agendamento cancelado.' : receipt.outcome === 'BLOCKED' ? 'Bloqueio registrado.'
      : receipt.series_refs?.length ? `${receipt.series_refs.length + 1} horários registrados (série).` : 'Horário registrado.';
    return `${title}${snapshot ? `\n${snapshot.customer_name ?? ''}\n${formatLocalRange(snapshot.startLocal, snapshot.endLocal, reference)}\n${snapshot.professional_name}` : ''}`;
  }
  if (view.communication?.receipt) return view.communication.delivery?.status === 'FAILED'
    ? 'Intenção registrada. A simulação de envio falhou; a ação de negócio foi preservada.'
    : 'Mensagem registrada para simulação. Nenhuma entrega externa.';
  if (view.batch && action) {
    const snapshot = view.batch.proposal?.snapshot;
    const item = action.operation === 'appointment.cancel' ? snapshot?.cancel : snapshot?.create;
    if (item) return `${item.customer_name}\n${formatLocalRange(item.startLocal, item.endLocal, reference)}\n${item.professional_name}${'service_name' in item ? ` · ${item.service_name}` : ''}`;
  }
  // B7: a text Luna drafted is a suggestion the owner reviews (the preview keeps the exact text below the label).
  const suggested = view.communication?.proposal?.fields?.message_mode === 'GENERATED' && proposalOf(view) === view.communication.proposal;
  // C7 (review): the customer's other upcoming appointments, screen only (never in the preview the model reads); those
  // another action of the same plan cancels or moves are not listed.
  const booking = view.scheduling?.proposal && proposalOf(view) === view.scheduling.proposal && view.scheduling.proposal.snapshot
    ? existingBookingNotice(view.scheduling.proposal.snapshot.customer_name, view.scheduling.proposal.existing_bookings ?? [], released, reference) : '';
  return `${suggested ? `${suggestedTextLabel}\n` : ''}${humanMessage(proposalOf(view)?.preview ?? view.message)}${booking}`;
}
/** C7 (review): appointments that another action of the plan cancels or moves (unless that action was discarded or failed),
 * so a NEW booking's card does not list them as the customer's existing appointments. */
export function planReleasedAppointments(root: SecretaryView | undefined): Set<string> {
  const refs = new Set<string>();
  for (const action of root?.action_plan?.actions ?? []) {
    if (!['appointment.cancel', 'appointment.change'].includes(action.operation) || ['DISCARDED', 'FAILED_SAFE', 'DOMAIN_CONFLICT', 'UNSUPPORTED', 'BLOCKED_BY_DEPENDENCY'].includes(action.status)) continue;
    const view = viewForAction(root!, action)?.state;
    const scheduling = view?.scheduling ?? (action.operation === 'appointment.cancel' ? view?.communication?.cancel : undefined);
    const ref = scheduling?.proposal?.action_snapshot?.appointment_ref ?? scheduling?.fields?.appointment_ref
      ?? (action.operation === 'appointment.cancel' ? view?.batch?.proposal?.snapshot?.cancel?.appointment_ref ?? view?.batch?.draft?.snapshot?.cancel?.appointment_ref : undefined);
    if (ref) refs.add(ref);
  }
  return refs;
}
export function destinationFor(view: SecretaryView, action?: PlanAction) {
  const operation = action?.operation ?? (view.inventory ? 'stock.movement' : view.scheduling || view.batch ? 'appointment.change' : view.customer ? 'customer.change' : view.financial ? 'financial.report' : 'service.change');
  if (operation.startsWith('appointment.') || operation === 'schedule.block') {
    const date = (view.scheduling?.receipt?.action_snapshot ?? view.scheduling?.receipt?.snapshot ?? view.scheduling?.proposal?.action_snapshot ?? view.scheduling?.proposal?.snapshot)?.startLocal?.slice(0, 10) ?? view.batch?.proposal?.snapshot?.create.startLocal.slice(0, 10);
    return { href: `/agenda${date ? `?date=${encodeURIComponent(date)}` : ''}`, label: 'Ver na agenda' };
  }
  if (operation.startsWith('stock.') || operation === 'product.search') return { href: '/produtos', label: 'Ver produtos' };
  if (operation.startsWith('customer.')) return { href: '/clientes', label: 'Ver clientes' };
  if (operation === 'financial.report') return { href: '/financeiro', label: 'Ver financeiro' };
  return { href: '/servicos', label: 'Ver serviços' };
}
export function legacyConfirmLabel(view: SecretaryView) {
  return view.inventory ? 'Confirmar movimentação' : view.batch ? 'Confirmar alterações' : view.communication ? 'Confirmar mensagem simulada' : view.scheduling ?
    view.scheduling.operation === 'appointment.change' ? alters(view.scheduling.operation, view.scheduling.fields) ? 'Confirmar alteração' : 'Confirmar remarcação' : view.scheduling.operation === 'appointment.cancel' ? 'Confirmar cancelamento' : view.scheduling.operation === 'schedule.block' ? 'Confirmar bloqueio' : 'Confirmar agendamento'
    : proposalOf(view) && 'change' in proposalOf(view)! && (proposalOf(view) as { change?: unknown }).change ? 'Confirmar alteração' : 'Confirmar cadastro';
}
/** C3 voice: applies one accepted correction only while the text still holds the suggested word at that position;
 * the other suggestions shift with it. Returns undefined when the text changed (the suggestions are dropped). */
export function acceptDictationSuggestion(text: string, items: readonly DictationSuggestion[], chosen: DictationSuggestion) {
  if (text.slice(chosen.start, chosen.end) !== chosen.from) return undefined;
  const delta = chosen.to.length - chosen.from.length;
  return { text: text.slice(0, chosen.start) + chosen.to + text.slice(chosen.end),
    items: items.filter(item => item !== chosen).map(item => item.start > chosen.start ? { ...item, start: item.start + delta, end: item.end + delta } : item) };
}
