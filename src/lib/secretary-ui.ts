import { proposalHasExpired, expiredProposalMessage } from './secretary-proposal-lifetime';
import type { PlanAction } from '@everflair/salon-secretary';
import type { SecretaryView } from './salon-secretary';

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
  DOMAIN_CONFLICT: 'Revisão necessária', UNSUPPORTED: 'Não disponível', FAILED_SAFE: 'Não concluído',
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
export function viewForAction(root: SecretaryView, action: PlanAction) {
  return root.operations?.find(operation => operation.action_keys?.includes(action.key));
}
export function actionEntity(action: PlanAction) {
  const f = action.fields;
  const scheduling = f as Record<string, unknown>;
  return (typeof scheduling.customer_name === 'string' ? scheduling.customer_name : undefined) ?? f.target_name ?? f.name ?? f.inventory?.product_name ?? f.communication?.recipient_name ?? (typeof scheduling.service_name === 'string' ? scheduling.service_name : '');
}
export function actionDetails(view: SecretaryView | undefined, action?: PlanAction) {
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
      : receipt.outcome === 'CANCELLED' ? 'Agendamento cancelado.' : receipt.outcome === 'BLOCKED' ? 'Bloqueio registrado.' : 'Horário registrado.';
    return `${title}${snapshot ? `\n${snapshot.customer_name ?? ''}\n${snapshot.startLocal.replace('T', ' às ')} → ${snapshot.endLocal.split('T')[1]}\n${snapshot.professional_name}` : ''}`;
  }
  if (view.communication?.receipt) return view.communication.delivery?.status === 'FAILED'
    ? 'Intenção registrada. A simulação de envio falhou; a ação de negócio foi preservada.'
    : 'Mensagem registrada para simulação. Nenhuma entrega externa.';
  if (view.batch && action) {
    const snapshot = view.batch.proposal?.snapshot;
    const item = action.operation === 'appointment.cancel' ? snapshot?.cancel : snapshot?.create;
    if (item) return `${item.customer_name}\n${item.startLocal.replace('T', ' às ')} → ${item.endLocal.split('T')[1]}\n${item.professional_name}${'service_name' in item ? ` · ${item.service_name}` : ''}`;
  }
  return humanMessage(proposalOf(view)?.preview ?? view.message);
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
    view.scheduling.operation === 'appointment.change' ? 'Confirmar remarcação' : view.scheduling.operation === 'appointment.cancel' ? 'Confirmar cancelamento' : view.scheduling.operation === 'schedule.block' ? 'Confirmar bloqueio' : 'Confirmar agendamento'
    : proposalOf(view) && 'change' in proposalOf(view)! && (proposalOf(view) as { change?: unknown }).change ? 'Confirmar alteração' : 'Confirmar cadastro';
}
