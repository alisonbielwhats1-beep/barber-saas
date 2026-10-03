// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
import { statusLabels } from '../secretary-ui';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), discard: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start, startAndSendSecretary: async (input: object) => { const opened = await mocks.start(); return opened?.ok ? mocks.send({ ...input, sessionId: opened.state.sessionId }) : opened; }, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, selectSecretaryService: mocks.select,
  selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation, discardSecretaryAction: mocks.discard }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** B3 "Descartar esta ação": one outline button per open card; it calls the discard server action with the
 * exact {plan_ref, action_key}; a discarded action leaves the live cards; nothing is confirmed. */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const proposal = { proposal_ref: 'proposal', draft_ref: 'draft', draft_revision: 1, payload_hash: 'hash', expires_at: '2099-01-01T00:00:00Z', preview: 'Massagem\nR$ 100,00 → R$ 80,00', change: { before: { priceCents: 10000 } } };
function planned(count: number): SecretaryView {
  let actionPlan = createActionPlan(plan(Array.from({ length: count }, (_, i) => intent('service.change', { item_key: `a${i}`, target_name: `Massagem ${i + 1}`, priceCents: 8000 }))));
  for (const action of actionPlan.actions) actionPlan = assessPlanAction(actionPlan, action.key, { status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview: proposal.preview, proposal_token: action.key });
  return { ...base, capability_status: 'SUPPORTED', action_plan: actionPlan, operations: actionPlan.actions.map(action => ({ operation_ref: `op-${action.key}`, action_keys: [action.key], state: { ...base, proposal } as unknown as SecretaryView })) };
}
function discarded(view: SecretaryView, key: string): SecretaryView {
  const next = structuredClone(view);
  next.action_plan = assessPlanAction(next.action_plan!, key, { status: 'DISCARDED', missing_fields: [], issue: 'DISCARDED_BY_USER' });
  next.operations = next.operations!.filter(op => !op.action_keys?.includes(key));
  next.message = 'Certo, descartei a alteração do serviço Massagem 2. Nada foi alterado.';
  return next;
}
const ok = (state: SecretaryView) => ({ ok: true, state });
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockResolvedValue(ok(base)); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view: SecretaryView) { mocks.start.mockResolvedValue(ok(view)); const user = userEvent.setup(); render(<SecretaryChat />); await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user; }

describe('Descartar esta ação', () => {
  it('each open card offers the outline discard; it sends the exact plan-bound key and the action leaves the live cards', async () => {
    const view = planned(3), user = await open(view);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(within(card).getByRole('button', { name: 'Descartar esta ação' })).toBeEnabled();
    const after = discarded(view, 'a1');
    mocks.discard.mockResolvedValue(ok(after));
    await user.click(within(cards[1]).getByRole('button', { name: 'Descartar esta ação' }));
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith('session', { plan_ref: view.action_plan!.plan_ref, action_key: 'a1' });
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.readyGroups).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
    const live = screen.getAllByRole('article');
    expect(live).toHaveLength(2); expect(live.map(card => card.getAttribute('aria-label'))).toEqual(['Alterar serviço — Massagem 1', 'Alterar serviço — Massagem 3']);
    expect(screen.getByRole('log')).toHaveTextContent('Certo, descartei a alteração do serviço Massagem 2. Nada foi alterado.');
    expect(screen.getByText(/^2 ações · /)).toBeVisible();
    // The kept actions stay confirmable, only through the NEW revision's group (the discarded key left it).
    const [group] = after.action_plan!.confirmation_groups;
    expect(group.action_keys).toEqual(['a0', 'a2']); expect(after.action_plan!.revision).toBeGreaterThan(view.action_plan!.revision);
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(mocks.group).toHaveBeenCalledExactlyOnceWith('session', { plan_ref: after.action_plan!.plan_ref, revision: after.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint });
  });
  it('completed actions have no discard button; a refused discard shows the backend message and keeps the cards', async () => {
    const view = planned(2);
    view.action_plan = assessPlanAction(view.action_plan!, 'a0', { status: 'DONE', missing_fields: [], preview: 'Concluído.' });
    view.operations![0].state.receipt = { service: { id: 'secret-id', name: 'Massagem 1', priceCents: 8000, durationMin: 30 } } as SecretaryView['receipt'];
    const user = await open(view), cards = screen.getAllByRole('article');
    expect(within(cards[0]).queryByRole('button', { name: 'Descartar esta ação' })).not.toBeInTheDocument();
    mocks.discard.mockResolvedValue({ ok: false, code: 'DISCARD_ALREADY_CONFIRMED', error: 'Esta ação já foi confirmada e não pode ser descartada. Nada foi alterado.' });
    await user.click(within(cards[1]).getByRole('button', { name: 'Descartar esta ação' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Esta ação já foi confirmada e não pode ser descartada.');
    expect(screen.getAllByRole('article')).toHaveLength(2); expect(screen.queryByText('Verificar resultado')).not.toBeInTheDocument();
  });
  it('a plan retired by a discard is archived with its final statuses ("descartada") and leaves no live card', async () => {
    expect(statusLabels.DISCARDED).toBe('Descartada');
    const view = planned(2), user = await open(view);
    let gone = view.action_plan!;
    for (const key of ['a0', 'a1']) gone = assessPlanAction(gone, key, { status: 'DISCARDED', missing_fields: [], issue: 'DISCARDED_BY_USER' });
    const retired: SecretaryView = { ...base, skill: 'auto', retired_plan: gone, message: 'Certo, descartei a alteração do serviço Massagem 1 e a alteração do serviço Massagem 2. Nada foi alterado.' };
    mocks.send.mockResolvedValue(ok(retired));
    await user.type(screen.getByLabelText('Mensagem'), 'Não, deixa. Esquece isso.'); await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', message: 'Não, deixa. Esquece isso.' });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Confirmar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveTextContent('Certo, descartei a alteração do serviço Massagem 1 e a alteração do serviço Massagem 2. Nada foi alterado.');
    const archived = screen.getByText('Pedido anterior · 2 ações').closest('details')!;
    expect(within(archived).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Alterar serviço — Massagem 1: descartada', 'Alterar serviço — Massagem 2: descartada']);
  });
  it('review 2b: a discard that would also take linked actions names them and waits for confirmation; "Manter" sends nothing', async () => {
    // a0 and a1 share one operation card (an atomic unit); a2 depends on a1.
    const view = planned(3);
    view.action_plan!.actions[2].depends_on = ['a1'];
    view.operations = [{ operation_ref: 'op-pair', action_keys: ['a0', 'a1'], state: { ...base, proposal } as unknown as SecretaryView },
      { operation_ref: 'op-a2', action_keys: ['a2'], state: { ...base, proposal } as unknown as SecretaryView }];
    const user = await open(view), first = screen.getAllByRole('article')[0];
    await user.click(within(first).getByRole('button', { name: 'Descartar esta ação' }));
    expect(mocks.discard).not.toHaveBeenCalled();
    const ask = within(first).getByRole('group', { name: 'Confirmar descarte' });
    expect(ask).toHaveTextContent('Descartar esta ação também descarta: Alterar serviço — Massagem 2; Alterar serviço — Massagem 3. Nada será executado.');
    await user.click(within(ask).getByRole('button', { name: 'Manter' }));
    expect(mocks.discard).not.toHaveBeenCalled(); expect(within(first).queryByRole('group', { name: 'Confirmar descarte' })).not.toBeInTheDocument();
    mocks.discard.mockResolvedValue(ok(view));
    await user.click(within(first).getByRole('button', { name: 'Descartar esta ação' }));
    await user.click(within(first).getByRole('button', { name: 'Descartar todas' }));
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith('session', { plan_ref: view.action_plan!.plan_ref, action_key: 'a0', linked: ['a1', 'a2'] });
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.readyGroups).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
