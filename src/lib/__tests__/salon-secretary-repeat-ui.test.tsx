// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), discard: vi.fn(), option: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, selectSecretaryService: mocks.select,
  selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation, discardSecretaryAction: mocks.discard,
  selectSecretaryOption: mocks.option }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** B6 on the screen: a repeated question points to its options (2nd time) and offers the agenda form (3rd time);
 * any link out of the conversation asks the dock to close. Nothing here confirms. */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
function asking(clarification: NonNullable<SecretaryView['clarifications']>[number], child: Partial<SecretaryView> = {}): SecretaryView {
  let actionPlan = createActionPlan(plan([intent('appointment.cancel', { item_key: 'a', customer_name: 'Amanda' })]));
  actionPlan = assessPlanAction(actionPlan, 'a', { status: 'NEEDS_INPUT', missing_fields: ['appointment_ref'], preview: 'Qual agendamento?' });
  return { ...base, capability_status: 'AMBIGUOUS', message: 'Qual agendamento você quer cancelar?', action_plan: actionPlan, clarifications: [clarification],
    operations: [{ operation_ref: 'op-a', action_keys: ['a'], state: { ...base, ...child } as SecretaryView }] };
}
const candidates = { scheduling: { candidates: { kind: 'appointment_ref', items: [{ id: 'private-early', name: 'Amanda Souza — qui, 01/10 às 10h' }, { id: 'private-late', name: 'Amanda Souza — qui, 01/10 às 14h' }] } } as unknown as SecretaryView['scheduling'] };
const ok = (state: SecretaryView) => ({ ok: true, state });
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockResolvedValue(ok(base)); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view: SecretaryView, onNavigate?: () => void) {
  mocks.start.mockResolvedValue(ok(view)); const user = userEvent.setup();
  render(<SecretaryChat onNavigate={onNavigate} />); await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user;
}
// jsdom cannot navigate; the link's own click handler is what is under test.
beforeEach(() => { document.addEventListener('click', event => { if ((event.target as HTMLElement).closest?.('a')) event.preventDefault(); }); });

describe('repeated question on the screen', () => {
  it('first time: the card shows its options as always, with no extra hint or link', async () => {
    await open(asking({ action_key: 'a', field: 'appointment', attempt: 1 }, candidates));
    expect(within(screen.getByLabelText('Opções encontradas')).getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByText('Se preferir, toque em uma das opções abaixo.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir no formulário da agenda' })).not.toBeInTheDocument();
  });
  it('second time: the backend options are pointed out; a click still selects through the backend, never confirms', async () => {
    const user = await open(asking({ action_key: 'a', field: 'appointment', attempt: 2, options: [{ option_id: 'opt_1', label: 'Amanda Souza — qui, 01/10 às 10h' }, { option_id: 'opt_2', label: 'Amanda Souza — qui, 01/10 às 14h' }] }, candidates));
    expect(screen.getByText('Se preferir, toque em uma das opções abaixo.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Abrir no formulário da agenda' })).not.toBeInTheDocument();
    mocks.selectOperation.mockResolvedValue(ok(asking({ action_key: 'a', field: 'appointment', attempt: 2 }, candidates)));
    await user.click(screen.getByRole('button', { name: '2. Amanda Souza — qui, 01/10 às 14h' }));
    expect(mocks.selectOperation).toHaveBeenCalledWith('session', 'op-a', 'private-late');
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.readyGroups).not.toHaveBeenCalled();
  });
  it('third time: "Abrir no formulário da agenda" with the server link (ids/dates only); following it closes the dock', async () => {
    const onNavigate = vi.fn();
    const user = await open(asking({ action_key: 'a', field: 'reason', attempt: 3, fallback: { href: '/agenda?date=2026-10-01&appointment=appt-1', label: 'Abrir no formulário da agenda' } }), onNavigate);
    const link = screen.getByRole('link', { name: 'Abrir no formulário da agenda' });
    expect(link).toHaveAttribute('href', '/agenda?date=2026-10-01&appointment=appt-1');
    expect(within(screen.getByRole('article')).getByRole('link', { name: 'Abrir no formulário da agenda' })).toBe(link);
    await user.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('a link that does not lead to the agenda is never rendered', async () => {
    await open(asking({ action_key: 'a', field: 'reason', attempt: 3, fallback: { href: 'https://example.test/agenda', label: 'Abrir no formulário da agenda' } }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('"Ver na agenda" after a receipt also closes the dock', async () => {
    const onNavigate = vi.fn();
    let actionPlan = createActionPlan(plan([intent('appointment.cancel', { item_key: 'a', customer_name: 'Amanda' })]));
    actionPlan = assessPlanAction(actionPlan, 'a', { status: 'DONE', missing_fields: [], preview: 'Concluído.' });
    const receipt = { outcome: 'CANCELLED', appointment_ref: 'secret-id', action_snapshot: { customer_name: 'Amanda Souza', startLocal: '2026-10-01T10:00', endLocal: '2026-10-01T11:00', professional_name: 'Tatiana' } };
    const user = await open({ ...base, action_plan: actionPlan, operations: [{ operation_ref: 'op-a', action_keys: ['a'], state: { ...base, scheduling: { receipt } } as unknown as SecretaryView }] }, onNavigate);
    const link = screen.getByRole('link', { name: 'Ver na agenda' });
    expect(link).toHaveAttribute('href', '/agenda?date=2026-10-01');
    await user.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
