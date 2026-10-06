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
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start,
  startAndSendSecretary: async (input: object) => { const opened = await mocks.start(); return opened?.ok ? mocks.send({ ...input, sessionId: opened.state.sessionId }) : opened; },
  sendSecretary: mocks.send, confirmSecretary: mocks.confirm, confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel,
  selectSecretaryService: mocks.select, selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation,
  discardSecretaryAction: mocks.discard, selectSecretaryOption: mocks.option }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** Owner 06/10 (mobile): the message box and the decision window are usable on a phone: one-line composer, status and
 * "Cancelar conversa" on one row, and Confirmar outside the part of the window that scrolls. Nothing here confirms by itself. */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const preview = 'REMARCAR AGENDAMENTO\nSérgio Antunes\nCorte\nOtávio\nANTES: qua, 07/10 às 15h–15h30\nDEPOIS: seg, 12/10 às 10h–10h30\nPreço mantido: R$ 40,00\nLista de espera: ninguém.';
const proposal = { proposal_ref: 'proposal', draft_revision: 1, preview, expires_at: new Date(Date.now() + 600_000).toISOString() };
function ready(): SecretaryView {
  let actionPlan = createActionPlan(plan([intent('appointment.change', { item_key: 'a', customer_name: 'Sérgio' })]));
  actionPlan = assessPlanAction(actionPlan, 'a', { status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview, proposal_token: 'a' });
  return { ...base, message: 'Preparei a remarcação. Confira antes de confirmar.', action_plan: actionPlan,
    operations: [{ operation_ref: 'op-a', action_keys: ['a'], state: { ...base, proposal } as unknown as SecretaryView }] };
}
const ok = (state: SecretaryView) => ({ ok: true, state });
class Recognition {
  static current: Recognition; lang = ''; continuous = false; interimResults = false;
  onstart?: () => void; onend?: () => void; onresult?: (e: unknown) => void; onerror?: (e: { error: string }) => void;
  constructor() { Recognition.current = this; } start() { this.onstart?.(); } stop() { this.onend?.(); } abort() {}
}
/** A phone: narrow screen and touch (the media queries the chat asks about all match). */
const phone = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('SpeechRecognition', Recognition); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view: SecretaryView, props: { voiceEnabled?: boolean } = {}) {
  mocks.start.mockResolvedValue(ok(view)); const user = userEvent.setup(); render(<SecretaryChat flowEnabled {...props} />);
  await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user;
}

describe('decision window on a phone', () => {
  it('keeps Confirmar and the way out outside the scrolling part, which holds the summary and the answer box', async () => {
    const user = await open(ready(), { voiceEnabled: true });
    const window = screen.getByRole('dialog');
    const confirm = within(window).getByRole('button', { name: 'Confirmar' });
    const scrolling = window.querySelector('.overflow-y-auto') as HTMLElement;
    expect(scrolling).not.toBeNull();
    expect(scrolling.contains(confirm)).toBe(false);
    expect(scrolling.contains(within(window).getByText('REMARCAR AGENDAMENTO'))).toBe(true);
    expect(scrolling.contains(within(window).getByLabelText('Responder digitando'))).toBe(true);
    for (const name of ['Descartar pedido', 'Decidir depois']) expect(scrolling.contains(within(window).getByRole('button', { name }))).toBe(false);
    // The summary reads ANTES and DEPOIS as two rows; the microphone and send are icons beside the answer box, still named.
    expect(within(window).getByText('Antes').nextElementSibling).toHaveTextContent('qua, 07/10 às 15h–15h30');
    expect(within(window).getByText('Depois').nextElementSibling).toHaveTextContent('seg, 12/10 às 10h–10h30');
    expect(within(window).getByRole('button', { name: 'Falar' })).toBeVisible();
    expect(within(window).getByRole('button', { name: 'Enviar resposta' })).toBeVisible();
    expect(within(window).getByRole('button', { name: 'Fechar janela de decisão' })).toHaveClass('w-11');
    // Nothing was confirmed by opening it.
    expect(mocks.group).not.toHaveBeenCalled(); expect(user).toBeDefined();
  });
  it('Confirmar still sends exactly the group approval, only when tapped', async () => {
    const user = await open(ready());
    mocks.group.mockResolvedValue(ok({ ...ready(), message: 'Feito.' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar' }));
    expect(mocks.group).toHaveBeenCalledOnce();
  });
});

describe('composer on a phone', () => {
  it('is a one-line box with the microphone and Enviar beside it, named for screen readers, and grows no taller than the stylesheet allows', async () => {
    phone(); render(<SecretaryChat voiceEnabled />);
    const box = screen.getByRole('textbox', { name: 'Mensagem' }) as HTMLTextAreaElement;
    expect(box).toHaveAttribute('rows', '1'); expect(box).toHaveClass('sec-input');
    expect(box).toHaveAttribute('placeholder', 'Ex.: Massagem para R$90');
    const mic = screen.getByRole('button', { name: 'Falar com a Secretária' }), send = screen.getByRole('button', { name: 'Enviar' });
    expect(mic.parentElement).toBe(send.parentElement); expect(mic.parentElement).toHaveClass('sec-buttons'); expect(box.parentElement).toContainElement(mic);
    expect(within(send).getByText('Enviar')).toHaveClass('sec-label'); expect(within(mic).getByText('Falar')).toHaveClass('sec-label');
    // The visible label of the box and the idle status are left to screen readers on the phone (the stylesheet decides).
    expect(screen.getByText('Mensagem', { selector: 'label' })).toHaveClass('sec-label');
    expect(screen.getByRole('status')).toHaveClass('sec-status-idle'); expect(screen.getByRole('status')).toHaveTextContent('Fale ou escreva');
  });
  it('names the buttons, not Enter and Esc, while listening on a touch screen', async () => {
    phone(); const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />);
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    expect(screen.getByRole('status')).toHaveTextContent('Toque em Enviar para mandar ou em Parar para revisar antes.');
    expect(screen.getByRole('status')).not.toHaveTextContent('Esc');
    expect(within(screen.getByRole('button', { name: 'Parar gravação' })).getByText('Parar')).not.toHaveClass('sec-label');
  });
  it('puts "Cancelar conversa" on the status row once a conversation is open, and keeps the long example on wider screens', async () => {
    const user = await open(ready());
    const status = screen.getByRole('status');
    expect(status.parentElement).toContainElement(screen.getByRole('button', { name: 'Cancelar conversa' }));
    cleanup(); render(<SecretaryChat />);
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveAttribute('placeholder', 'Ex.: altera a Massagem para R$90'); expect(user).toBeDefined();
  });
});
