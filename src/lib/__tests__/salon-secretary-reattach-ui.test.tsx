// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), current: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start, startAndSendSecretary: async (input: object) => { const opened = await mocks.start(); return opened?.ok ? mocks.send({ ...input, sessionId: opened.state.sessionId }) : opened; }, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, selectSecretaryService: mocks.select,
  selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation, currentSecretary: mocks.current }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** D1 on the screen: when the dock first becomes active the chat asks once for the owner's latest open conversation
 * (SALON_SECRETARY_PERSISTED_STATE) and, only into an untouched chat, shows it as the server holds it; confirming it
 * sends the exact approval of that server state. A learned alias card highlights its single proposed option. */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const proposal = { proposal_ref: 'proposal', draft_ref: 'draft', draft_revision: 1, payload_hash: 'hash', expires_at: '2099-01-01T00:00:00Z', preview: 'Massagem\nR$ 100,00 → R$ 80,00', change: { before: { priceCents: 10000 } } };
function planned(): SecretaryView {
  let actionPlan = createActionPlan(plan([intent('service.change', { item_key: 'a0', target_name: 'Massagem', priceCents: 8000 })]));
  actionPlan = assessPlanAction(actionPlan, 'a0', { status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview: proposal.preview, proposal_token: 'a0' });
  return { ...base, sessionId: 'reattached', message: 'Pronto para confirmar.', action_plan: actionPlan,
    operations: [{ operation_ref: 'op-a0', action_keys: ['a0'], state: { ...base, proposal } as unknown as SecretaryView }] };
}
const ok = (state: SecretaryView | null) => ({ ok: true, state });
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockResolvedValue(ok(base)); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); mocks.current.mockResolvedValue(ok(null)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('reattaching the latest open conversation (D1)', () => {
  it('nothing to reattach (persisted state off): asked once, the chat starts empty as before', async () => {
    const { rerender } = render(<SecretaryChat />);
    await waitFor(() => expect(mocks.current).toHaveBeenCalledTimes(1));
    rerender(<SecretaryChat active={false} />); rerender(<SecretaryChat active />);
    expect(mocks.current).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Como posso ajudar?' })).toBeTruthy();
    expect(mocks.start).not.toHaveBeenCalled(); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('an inactive dock does not ask until it opens', async () => {
    const { rerender } = render(<SecretaryChat active={false} />);
    expect(mocks.current).not.toHaveBeenCalled();
    rerender(<SecretaryChat active />);
    await waitFor(() => expect(mocks.current).toHaveBeenCalledTimes(1));
  });
  it('the server conversation comes back with its reply and live cards; Confirm sends the exact approval of that state', async () => {
    const view = planned(); mocks.current.mockResolvedValue(ok(view)); mocks.group.mockResolvedValue(ok(view));
    const user = userEvent.setup(); render(<SecretaryChat />);
    expect(await screen.findByText('Pronto para confirmar.')).toBeTruthy();
    const log = screen.getByRole('log');
    expect(within(log).getByText('Pronto para confirmar.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    const group = view.action_plan!.confirmation_groups[0];
    expect(mocks.group).toHaveBeenCalledWith('reattached', { plan_ref: view.action_plan!.plan_ref, revision: view.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('a late answer never overrides what the owner already started; a failure changes nothing', async () => {
    let answer!: (reply: unknown) => void;
    mocks.current.mockReturnValue(new Promise(resolve => { answer = resolve; }));
    const user = userEvent.setup(); render(<SecretaryChat />);
    await user.click(screen.getByRole('button', { name: 'Nova conversa' }));
    answer(ok(planned()));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Pronto para confirmar.')).toBeNull();
    cleanup(); vi.resetAllMocks(); mocks.current.mockRejectedValue(Error('network'));
    render(<SecretaryChat />);
    await waitFor(() => expect(mocks.current).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByRole('heading', { name: 'Como posso ajudar?' })).toBeTruthy();
  });
});

describe('learned alias card (D1, SALON_SECRETARY_NAME_ALIASES)', () => {
  it('the proposed entity is the single highlighted option; the refusal is an ordinary option; a click only selects', async () => {
    let actionPlan = createActionPlan(plan([intent('appointment.change', { item_key: 'a', customer_name: 'Fabinho' })]));
    actionPlan = assessPlanAction(actionPlan, 'a', { status: 'NEEDS_INPUT', missing_fields: ['customer_ref'], preview: 'Fabinho → Fábio Santos · (11) *****-0003 — confirmar?' });
    const view: SecretaryView = { ...base, capability_status: 'NEEDS_INPUT', message: 'Fabinho → Fábio Santos · (11) *****-0003 — confirmar?', action_plan: actionPlan,
      operations: [{ operation_ref: 'op-a', action_keys: ['a'], state: { ...base, scheduling: { candidates: { kind: 'customer_ref', source: 'alias',
        items: [{ id: 'c-fabio', name: 'Fábio Santos · (11) *****-0003' }, { id: 'alias-not-this', name: 'Não é essa pessoa' }] } } } as unknown as SecretaryView }] };
    mocks.start.mockResolvedValue(ok(view)); mocks.selectOperation.mockResolvedValue(ok(view));
    const user = userEvent.setup(); render(<SecretaryChat />);
    await user.click(screen.getByRole('button', { name: 'Nova conversa' }));
    const [proposed, refuse] = within(screen.getByLabelText('Opções encontradas')).getAllByRole('button');
    expect(proposed.textContent).toBe('1. Fábio Santos · (11) *****-0003'); expect(refuse.textContent).toBe('2. Não é essa pessoa');
    expect(proposed.className).toContain('bg-primary'); expect(refuse.className).toContain('border');
    expect(mocks.group).not.toHaveBeenCalled();
    await user.click(refuse);
    expect(mocks.selectOperation).toHaveBeenCalledWith('session', 'op-a', 'alias-not-this');
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
