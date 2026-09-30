// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), discard: vi.fn(), option: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, selectSecretaryService: mocks.select,
  selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation, discardSecretaryAction: mocks.discard,
  selectSecretaryOption: mocks.option }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** B4 on the screen: candidate buttons are numbered like the question lists them; backend time-slot
 * alternatives are buttons that prepare a new proposal (never confirm); a hard block still offers no override. */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
function waiting(child: Partial<SecretaryView>, status: 'NEEDS_INPUT' | 'DOMAIN_CONFLICT' = 'NEEDS_INPUT'): SecretaryView {
  let actionPlan = createActionPlan(plan([intent('appointment.change', { item_key: 'a', customer_name: 'Amanda' })]));
  actionPlan = assessPlanAction(actionPlan, 'a', { status, missing_fields: ['time'], preview: 'Esse horário está indisponível.' });
  return { ...base, capability_status: 'NEEDS_INPUT', message: 'Esse horário está indisponível. Qual horário você prefere?', action_plan: actionPlan,
    operations: [{ operation_ref: 'op-a', action_keys: ['a'], state: { ...base, ...child } as SecretaryView }] };
}
const ok = (state: SecretaryView) => ({ ok: true, state });
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockResolvedValue(ok(base)); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view: SecretaryView) { mocks.start.mockResolvedValue(ok(view)); const user = userEvent.setup(); render(<SecretaryChat />); await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user; }

describe('options on the screen', () => {
  it('candidates are numbered in the order the question lists them; a click still sends the backend-validated ref', async () => {
    const view = waiting({ scheduling: { candidates: { kind: 'customer_ref', items: [{ id: 'private-souza', name: 'Amanda Souza · (11) *****-0001' }, { id: 'private-lima', name: 'Amanda Lima · (11) *****-0002' }] } } as unknown as SecretaryView['scheduling'] });
    const user = await open(view);
    const group = screen.getByLabelText('Opções encontradas');
    expect(within(group).getAllByRole('button').map(button => button.textContent)).toEqual(['1. Amanda Souza · (11) *****-0001', '2. Amanda Lima · (11) *****-0002']);
    expect(document.body.textContent).not.toContain('private-');
    mocks.selectOperation.mockResolvedValue(ok(view));
    await user.click(screen.getByRole('button', { name: '2. Amanda Lima · (11) *****-0002' }));
    expect(mocks.selectOperation).toHaveBeenCalledWith('session', 'op-a', 'private-lima');
  });
  it('time-slot alternatives are numbered buttons: a click sends the option id and the shown revision, never a confirmation', async () => {
    const view = waiting({ scheduling: { waiting_for: 'time' } as unknown as SecretaryView['scheduling'], options: [{ option_id: 'opt_1', label: 'sex, 02/10 às 15h' }, { option_id: 'opt_2', label: 'sex, 02/10 às 17h' }] });
    const user = await open(view);
    const slots = screen.getByLabelText('Horários disponíveis');
    expect(within(slots).getAllByRole('button').map(button => button.textContent)).toEqual(['1. sex, 02/10 às 15h', '2. sex, 02/10 às 17h']);
    mocks.option.mockResolvedValue(ok(view));
    await user.click(screen.getByRole('button', { name: '2. sex, 02/10 às 17h' }));
    expect(mocks.option).toHaveBeenCalledWith('session', 'op-a', 'opt_2', view.action_plan!.revision);
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.readyGroups).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('HARD_BLOCK: the backend slots are the only controls (no override/encaixe); the text list gives way to the buttons', async () => {
    const view = waiting({ options: [{ option_id: 'opt_1', label: 'qua, 02/01/2030 às 11h' }],
      scheduling: { draft: { review: { status: 'CONFLICT_HARD_BLOCK', message: 'Salão fechado.', override_allowed: false, alternatives: [{ startLocal: '2030-01-02T11:00' }] } } } as unknown as SecretaryView['scheduling'] }, 'DOMAIN_CONFLICT');
    await open(view);
    expect(screen.getByText('Este horário não pode ser usado')).toBeVisible();
    expect(screen.queryByRole('button', { name: /encaix|override|ignorar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1. qua, 02/01/2030 às 11h' })).toBeEnabled();
    expect(screen.queryByText(/Alternativas disponíveis/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
  });
});
