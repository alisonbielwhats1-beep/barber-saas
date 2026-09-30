// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), discard: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, selectSecretaryService: mocks.select,
  selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation, discardSecretaryAction: mocks.discard }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** B5: a part left out of the request (or an answer not understood) is said even when the plan is ready and
 * the screen shows its own "ready" text; it is never hidden behind it. Nothing is confirmed. */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const proposal = { proposal_ref: 'proposal', draft_ref: 'draft', draft_revision: 1, payload_hash: 'hash', expires_at: '2099-01-01T00:00:00Z', preview: 'Massagem\nR$ 100,00 → R$ 80,00', change: { before: { priceCents: 10000 } } };
/** `status`: with a capability status the backend message (already carrying the notice) is shown; without one the screen writes its own ready text. */
function ready(turn_notice?: string, status = false): SecretaryView {
  let actionPlan = createActionPlan(plan([intent('service.change', { item_key: 'a0', target_name: 'Massagem', priceCents: 8000 })]));
  actionPlan = assessPlanAction(actionPlan, 'a0', { status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview: proposal.preview, proposal_token: 'a0' });
  return { ...base, ...(status ? { capability_status: 'SUPPORTED' as const } : {}), action_plan: actionPlan, ...(turn_notice ? { turn_notice, message: `${turn_notice}\n\n${proposal.preview}` } : {}),
    operations: [{ operation_ref: 'op-a0', action_keys: ['a0'], state: { ...base, proposal } as unknown as SecretaryView }] };
}
const ok = (state: SecretaryView) => ({ ok: true, state });
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockResolvedValue(ok(base)); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function say(reply: SecretaryView) {
  const user = userEvent.setup(); render(<SecretaryChat />);
  await user.click(screen.getByRole('button', { name: 'Nova conversa' }));
  mocks.send.mockResolvedValue(ok(reply));
  await user.type(screen.getByLabelText('Mensagem'), 'Muda a massagem para 80 e cadastra a Amanda');
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
}

describe('B5 turn notice on a ready plan', () => {
  it('a left-out part is shown before the ready text', async () => {
    const notice = 'Não entendi com segurança esta parte do pedido e a deixei de fora: “cadastra a Amanda”. Pode repetir essa parte de outro jeito?';
    await say(ready(notice));
    expect(screen.getByRole('log')).toHaveTextContent(`${notice} Preparei as ações. Confira os detalhes antes de confirmar.`);
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.readyGroups).not.toHaveBeenCalled();
  });
  it('the backend message (with its notice) is shown as is when the plan has a capability status', async () => {
    const notice = 'Não entendi com segurança esta parte do pedido e a deixei de fora: “cadastra a Amanda”. Pode repetir essa parte de outro jeito?';
    await say(ready(notice, true));
    expect(screen.getByRole('log')).toHaveTextContent(notice); expect(screen.getByRole('log')).not.toHaveTextContent('Preparei as ações');
  });
  // Review 2b contract migration: the backend's unread reply IS its notice (`turn_notice_alone`); the screen shows
  // only that notice, never its own "Preparei as ações" text beside it. Units the answer was not addressed to keep
  // their reviewed proposals, so their Confirmar stays (the addressed unit is held for review by the backend).
  it('an answer not understood shows only the backend notice (no "ready" text) and keeps the other ready units', async () => {
    const notice = 'Não entendi essa parte; o pedido foi preservado. Pode repetir de outro jeito?';
    await say({ ...ready(notice), message: notice, turn_notice_alone: true });
    expect(screen.getByRole('log')).toHaveTextContent(notice);
    expect(screen.getByRole('log')).not.toHaveTextContent('Preparei as ações');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.readyGroups).not.toHaveBeenCalled();
  });
  it('an action held for review offers no confirmation', async () => {
    const view = ready();
    view.action_plan = assessPlanAction(view.action_plan!, 'a0', { status: 'NEEDS_INPUT', missing_fields: [], issue: 'REVIEW_REQUIRED',
      preview: 'A alteração pedida para esta ação não foi aplicada. Os dados anteriores foram preservados; repita a alteração ou diga que mantém como estava para preparar uma nova proposta.' });
    view.operations![0].state = { ...base } as SecretaryView;
    await say(view);
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    expect(screen.getByText(/A alteração pedida para esta ação não foi aplicada/)).toBeVisible();
  });
  it('without a notice the ready text is unchanged', async () => {
    await say(ready());
    expect(screen.getByRole('log')).toHaveTextContent('Preparei as ações. Confira os detalhes antes de confirmar.');
    expect(screen.getByRole('log')).not.toHaveTextContent('Não entendi');
  });
});
