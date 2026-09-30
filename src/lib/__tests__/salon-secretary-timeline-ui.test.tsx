// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), discard: vi.fn(), feedback: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, selectSecretaryService: mocks.select,
  selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation, discardSecretaryAction: mocks.discard,
  sendSecretaryFeedback: mocks.feedback }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** B7 timeline (rec 11): per-turn entries {owner's words, reply, what the actions looked like}; past turns are read-only
 * text (no card, no button); only the newest turn's plan is live. Plus resolved names, the server's year reference and
 * the owner feedback control (flag, default off). */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const component = { normalReviewMax: 5, maxActionsPerConfirmationGroup: 10, grouping: 'component' as const };
const ok = (state: SecretaryView) => ({ ok: true, state });
const proposal = { proposal_ref: 'proposal', draft_ref: 'draft', draft_revision: 1, payload_hash: 'hash', expires_at: '2099-01-01T00:00:00Z', preview: 'Prévia' };
const snapshot = (kind: string, fields: object) => ({ kind, timezone: 'America/Sao_Paulo', services: [], resource_ids: [], waiting_count: 0, waiting_hash: '', requires_acceptance: false,
  professional_ref: 'pro', professional_name: 'Rodrigo Lima', startLocal: '2026-09-29T10:00', endLocal: '2026-09-29T11:00', ...fields });
/** The owner typed "fabio" and "rodrigo": both are ready and resolved by the backend ("Fábio Santos", "Rodrigo Lima"). */
function owner(): SecretaryView {
  let p = createActionPlan(plan([intent('appointment.change', { item_key: 'fabio', customer_name: 'fabio', day_offset: 1, time: '10:00' }),
    intent('schedule.block', { item_key: 'rodrigo', professional_name: 'rodrigo', date: '2026-09-29', time: '10:00', end_time: '11:00' })]), component);
  for (const key of ['fabio', 'rodrigo']) p = assessPlanAction(p, key, { status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview: `Prévia ${key}`, proposal_token: key });
  const child = (kind: string, fields: object) => ({ ...base, scheduling: { fields: {}, message: '', metrics: {}, proposal: { ...proposal, action_snapshot: snapshot(kind, fields) } } }) as unknown as SecretaryView;
  return { ...base, skill: 'auto', capability_status: 'SUPPORTED', today: '2026-09-28', message: 'Já dá para confirmar: remarcação de Fábio Santos e bloqueio de Rodrigo Lima.', action_plan: p,
    operations: [{ operation_ref: 'op-fabio', action_keys: ['fabio'], state: child('appointment.change', { customer_name: 'Fábio Santos' }) }, { operation_ref: 'op-rodrigo', action_keys: ['rodrigo'], state: child('schedule.block', {}) }] };
}
function services(count: number, price = 8000): SecretaryView {
  let p = createActionPlan(plan(Array.from({ length: count }, (_, i) => intent('service.change', { item_key: `a${i}`, target_name: `Massagem ${i + 1}`, priceCents: price }))));
  for (const action of p.actions) p = assessPlanAction(p, action.key, { status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview: 'Massagem', proposal_token: action.key });
  return { ...base, skill: 'auto', action_plan: p, operations: p.actions.map(action => ({ operation_ref: `op-${action.key}`, action_keys: [action.key], state: { ...base, proposal } as unknown as SecretaryView })) };
}
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockResolvedValue(ok(base)); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view: SecretaryView, props: { feedbackEnabled?: boolean } = {}) {
  mocks.start.mockResolvedValue(ok(view)); const user = userEvent.setup(); render(<SecretaryChat {...props} />);
  await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user;
}
async function say(user: ReturnType<typeof userEvent.setup>, text: string, reply: SecretaryView) {
  mocks.send.mockResolvedValueOnce(ok(reply)); await user.type(screen.getByLabelText('Mensagem'), text); await user.click(screen.getByRole('button', { name: 'Enviar' }));
}

describe('B7 timeline: past turns are read-only; only the newest turn is live', () => {
  it('each turn keeps the owner words, the reply and a collapsed summary of that moment, without cards or buttons', async () => {
    const first = services(2), user = await open(first);
    const second = structuredClone(first); second.action_plan!.revision++;
    await say(user, 'Na verdade R$90.', second);
    const log = screen.getByRole('log');
    expect(log).toHaveTextContent('Como posso ajudar?'); expect(log).toHaveTextContent('Na verdade R$90.'); expect(log).toHaveTextContent('Preparei as ações. Confira os detalhes antes de confirmar.');
    const past = within(log).getByText('Nesta etapa · 2 ações').closest('details')!;
    expect(within(past).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Alterar serviço — Massagem 1: aguardando confirmação', 'Alterar serviço — Massagem 2: aguardando confirmação']);
    // The newest turn is live below the conversation; nothing in the log is actionable.
    expect(within(log).queryAllByRole('article')).toHaveLength(0); expect(within(log).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getAllByText(/^Nesta etapa · /)).toHaveLength(1); // the newest turn's summary is the live plan itself
  });
  it('a replaced request stays at its last turn with its final statuses; the new request is the only live one', async () => {
    const user = await open(services(2));
    await say(user, 'Agora outra coisa.', { ...services(1, 9000), message: 'Novo pedido preparado.' });
    const archived = screen.getByText('Pedido anterior · 2 ações').closest('details')!;
    expect(within(archived).getAllByRole('listitem')).toHaveLength(2);
    expect(within(screen.getByRole('log')).getByText('Agora outra coisa.')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    // The earlier request comes before the owner's newest words.
    const text = screen.getByRole('log').textContent!;
    expect(text.indexOf('Pedido anterior · 2 ações')).toBeLessThan(text.indexOf('Agora outra coisa.'));
  });
  it('while the newest message waits for its reply, the previous cards are not shown under it', async () => {
    const user = await open(services(1));
    let finish!: (value: unknown) => void; mocks.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await user.type(screen.getByLabelText('Mensagem'), 'Mais uma coisa'); await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(within(screen.getByRole('log')).getByText('Nesta etapa · 1 ação')).toBeInTheDocument();
    finish(ok({ ...services(1), message: 'Pronto.' }));
    expect(await screen.findAllByRole('article')).toHaveLength(1);
  });
});

describe('B7 resolved names and the server year reference on screen', () => {
  it('cards and confirmations name the subject as registered, not as typed', async () => {
    await open(owner());
    expect(screen.getByRole('article', { name: 'Mudar horário — Fábio Santos' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Bloquear horário — Rodrigo Lima' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirmar remarcação de Fábio Santos' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Confirmar bloqueio de Rodrigo Lima' })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/\bfabio\b|\brodrigo\b/);
  });
  it.each([['2029-12-31', 'qua, 02/01/2030 às 11h'], ['2030-01-01', 'qua, 02/01 às 11h']])('today %s from the server: a date is shown as %s', async (today, shown) => {
    let p = createActionPlan(plan([intent('appointment.create', { item_key: 'a', customer_name: 'Amanda' })]));
    p = assessPlanAction(p, 'a', { status: 'DOMAIN_CONFLICT', missing_fields: ['destination_mode'], preview: 'Salão fechado.' });
    const child = { ...base, scheduling: { fields: {}, message: '', metrics: {}, draft: { review: { status: 'CONFLICT_HARD_BLOCK', message: 'Salão fechado.', override_allowed: false, alternatives: [{ startLocal: '2030-01-02T11:00' }] } } } } as unknown as SecretaryView;
    await open({ ...base, skill: 'auto', today, action_plan: p, operations: [{ operation_ref: 'op-a', action_keys: ['a'], state: child }] });
    expect(screen.getByText(/Alternativas disponíveis/)).toHaveTextContent(shown);
  });
});

describe("B7 owner feedback: 'Não era isso' (flag, default off)", () => {
  it('is absent by default', async () => {
    const user = await open(base);
    await say(user, 'Oi', { ...base, skill: 'auto', capability_status: 'CONVERSATION', message: 'Olá!' });
    expect(screen.queryByRole('button', { name: 'Não era isso' })).not.toBeInTheDocument();
  });
  it('only on the latest reply; the comment is optional; no conversation text without the checkbox; nothing else changes', async () => {
    const user = await open(base, { feedbackEnabled: true });
    expect(screen.queryByRole('button', { name: 'Não era isso' })).not.toBeInTheDocument(); // not on the greeting
    await say(user, 'Cancela a Amanda amanhã', { ...base, skill: 'auto', message: 'Qual o motivo do cancelamento?' });
    await say(user, 'Ela pediu', { ...base, skill: 'auto', message: 'Não entendi essa parte.' });
    expect(screen.getAllByRole('button', { name: 'Não era isso' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Não era isso' }));
    const form = screen.getByRole('form', { name: 'Avaliar esta resposta' });
    expect(within(form).getByRole('checkbox', { name: 'incluir o texto desta conversa para melhorar a Secretária' })).not.toBeChecked();
    mocks.feedback.mockResolvedValueOnce({ ok: true });
    await user.click(within(form).getByRole('button', { name: 'Enviar avaliação' }));
    expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', turn: 2, include_transcript: false });
    expect(screen.getByText('Obrigado. Sua avaliação foi registrada.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Não era isso' })).not.toBeInTheDocument();
    expect(mocks.send).toHaveBeenCalledTimes(2); expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('with the checkbox, the conversation shown on the screen goes with the comment', async () => {
    const user = await open(base, { feedbackEnabled: true });
    await say(user, 'Cancela a Amanda amanhã', { ...base, skill: 'auto', message: 'Qual o motivo do cancelamento?' });
    await user.click(screen.getByRole('button', { name: 'Não era isso' }));
    const form = screen.getByRole('form', { name: 'Avaliar esta resposta' });
    await user.type(within(form).getByLabelText('O que você esperava? (opcional)'), '  Era para amanhã à tarde. ');
    await user.click(within(form).getByRole('checkbox', { name: 'incluir o texto desta conversa para melhorar a Secretária' }));
    mocks.feedback.mockResolvedValueOnce({ ok: false, error: 'Não foi possível registrar a avaliação agora. A conversa não foi alterada.' });
    await user.click(within(form).getByRole('button', { name: 'Enviar avaliação' }));
    expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', turn: 1, comment: 'Era para amanhã à tarde.', include_transcript: true,
      transcript: [{ role: 'secretary', text: 'Como posso ajudar?' }, { role: 'owner', text: 'Cancela a Amanda amanhã' }, { role: 'secretary', text: 'Qual o motivo do cancelamento?' }] });
    expect(within(form).getByRole('alert')).toHaveTextContent('A conversa não foi alterada.');
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: 'Avaliar esta resposta' })).not.toBeInTheDocument();
  });
});
