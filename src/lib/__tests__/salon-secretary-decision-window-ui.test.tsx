// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), discard: vi.fn(), option: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start,
  startAndSendSecretary: async (input: object) => { const opened = await mocks.start(); return opened?.ok ? mocks.send({ ...input, sessionId: opened.state.sessionId }) : opened; },
  sendSecretary: mocks.send, confirmSecretary: mocks.confirm, confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel,
  selectSecretaryService: mocks.select, selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation,
  discardSecretaryAction: mocks.discard, selectSecretaryOption: mocks.option }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** Owner, 05/10/2026: every choice the Secretary waits for opens in one window above the conversation, one at a time
 * ("Decisão 1 de 2"); closed, a bar above the message box reopens it. The window never confirms anything. */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const customers = (...names: string[]) => ({ scheduling: { candidates: { kind: 'customer_ref', items: names.map((name, index) => ({ id: `ref-${index}-${name}`, name })) } } }) as unknown as Partial<SecretaryView>;
/** A plan with one moved appointment per given customer; `waiting` maps a key to the choices its own session waits for. */
function moves(waiting: Record<string, Partial<SecretaryView>>): SecretaryView {
  let actionPlan = createActionPlan(plan([intent('appointment.change', { item_key: 'a', customer_name: 'Adriana' }), intent('appointment.change', { item_key: 'b', customer_name: 'Isabela' })]));
  for (const key of ['a', 'b']) actionPlan = assessPlanAction(actionPlan, key, { status: 'NEEDS_INPUT', missing_fields: ['appointment_ref'], preview: `Qual cliente ${key === 'a' ? 'Adriana' : 'Isabela'}?` });
  return { ...base, capability_status: 'NEEDS_INPUT', message: 'Encontrei mais de uma cliente com esses nomes. Qual delas?', action_plan: actionPlan,
    operations: ['a', 'b'].map(key => ({ operation_ref: `op-${key}`, action_keys: [key], state: { ...base, ...(waiting[key] ?? {}) } as SecretaryView })) };
}
const ok = (state: SecretaryView) => ({ ok: true, state });
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockResolvedValue(ok(base)); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view: SecretaryView) { mocks.start.mockResolvedValue(ok(view)); const user = userEvent.setup(); render(<SecretaryChat />); await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user; }

describe('decision window', () => {
  it('opens on the first waiting choice, says how many there are, and goes on to the next once answered', async () => {
    const both = moves({ a: customers('Adriana Leal', 'Adriana Souza'), b: customers('Isabela Mattos', 'Isabela Prado') });
    const user = await open(both);
    const window = screen.getByRole('dialog');
    expect(within(window).getByText('Decisão 1 de 2')).toBeVisible();
    expect(within(window).getByText(/Adriana/, { selector: 'h2' })).toBeVisible();
    // The choice is in the window only (never twice on screen), and it takes the focus.
    expect(screen.getAllByRole('button', { name: '1. Adriana Leal' })).toHaveLength(1);
    await waitFor(() => expect(within(window).getByRole('button', { name: '1. Adriana Leal' })).toHaveFocus());
    mocks.selectOperation.mockResolvedValue(ok(moves({ b: customers('Isabela Mattos', 'Isabela Prado') })));
    await user.click(within(window).getByRole('button', { name: '1. Adriana Leal' }));
    expect(mocks.selectOperation).toHaveBeenCalledWith('session', 'op-a', 'ref-0-Adriana Leal');
    const next = screen.getByRole('dialog');
    expect(within(next).getByText('Decisão pendente')).toBeVisible();
    expect(within(next).getByRole('button', { name: '2. Isabela Prado' })).toBeVisible();
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.readyGroups).not.toHaveBeenCalled(); expect(mocks.confirmOperation).not.toHaveBeenCalled();
  });
  it('closed (button or Esc): a bar keeps the pending choices in reach and reopens the window; the cards show the choices meanwhile', async () => {
    const user = await open(moves({ a: customers('Adriana Leal', 'Adriana Souza'), b: customers('Isabela Mattos', 'Isabela Prado') }));
    // Wait for the window to settle (its first option takes the focus) before closing it: on a slow runner (CI) the close
    // could otherwise land before the opening frame and the window would reopen over it.
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: '1. Adriana Leal' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Decidir depois' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('2 decisões pendentes')).toBeVisible();
    expect(screen.getAllByRole('button', { name: '1. Adriana Leal' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Responder' }));
    expect(within(screen.getByRole('dialog')).getByText('Decisão 1 de 2')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('2 decisões pendentes')).toBeVisible();
  });
  it('"Responder por mensagem" closes the window and points the message box at that action', async () => {
    const user = await open(moves({ a: customers('Adriana Leal', 'Adriana Souza') }));
    await user.click(screen.getByRole('button', { name: 'Responder por mensagem' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Respondendo à ação selecionada.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveFocus();
    mocks.send.mockResolvedValue(ok(moves({})));
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'a Leal{Enter}');
    expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'a Leal', operation_ref: 'op-a' });
  });
  it('a reply with nothing to choose opens no window and no bar', async () => {
    await open(moves({}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/decis(ão|ões) pendente/)).not.toBeInTheDocument();
  });
});
