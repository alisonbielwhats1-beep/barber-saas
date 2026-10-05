// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
import { voiceConfirmIntent } from '../secretary-voice-confirm';
import { HANDS_FREE, createPauseDetector } from '../../app/(admin)/servicos/secretaria/use-secretary-voice';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), discard: vi.fn(), option: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start,
  startAndSendSecretary: async (input: object) => { const opened = await mocks.start(); return opened?.ok ? mocks.send({ ...input, sessionId: opened.state.sessionId }) : opened; },
  sendSecretary: mocks.send, confirmSecretary: mocks.confirm, confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel,
  selectSecretaryService: mocks.select, selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation,
  discardSecretaryAction: mocks.discard, selectSecretaryOption: mocks.option }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** Owner, 05/10/2026 (flag SALON_SECRETARY_FLOW_WINDOW): the window carries the open question and the confirmation too; a
 * conversation driven by voice keeps the microphone open at each step, and a spoken "confirma" confirms after 3 s with Cancelar. */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const proposal = { proposal_ref: 'proposal', draft_revision: 1, preview: 'Sérgio Antunes: qua, 07/10 às 15h → seg, 12/10 às 10h', expires_at: new Date(Date.now() + 600_000).toISOString() };
function sergio(status: 'NEEDS_INPUT' | 'READY_FOR_CONFIRMATION', message: string): SecretaryView {
  let actionPlan = createActionPlan(plan([intent('appointment.change', { item_key: 'a', customer_name: 'Sérgio' })]));
  actionPlan = assessPlanAction(actionPlan, 'a', status === 'NEEDS_INPUT' ? { status, missing_fields: ['date', 'time'], preview: 'Informe data e horário exato.' }
    : { status, missing_fields: [], preview: proposal.preview, proposal_token: 'a' });
  return { ...base, message, action_plan: actionPlan,
    operations: [{ operation_ref: 'op-a', action_keys: ['a'], state: { ...base, ...(status === 'READY_FOR_CONFIRMATION' ? { proposal } : {}) } as unknown as SecretaryView }] };
}
const asking = () => sergio('NEEDS_INPUT', 'Para qual dia e horário devo passar Sérgio Antunes?');
const ready = () => sergio('READY_FOR_CONFIRMATION', 'Preparei a remarcação. Confira antes de confirmar.');
const ok = (state: SecretaryView) => ({ ok: true, state });
class Recognition {
  static current: Recognition; lang = ''; continuous = false; interimResults = false;
  onstart?: () => void; onend?: () => void; onresult?: (e: unknown) => void; onerror?: (e: { error: string }) => void;
  constructor() { Recognition.current = this; } start() { this.onstart?.(); } stop() { this.onend?.(); } abort() {}
}
/** The browser recognizer hears `text` and the speech ends (the hands-free answer goes by itself). */
const hear = (text: string) => act(() => { Recognition.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: text } }] }); Recognition.current.onend?.(); });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('SpeechRecognition', Recognition); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view: SecretaryView, props: { voiceEnabled?: boolean } = {}) {
  mocks.start.mockResolvedValue(ok(view)); const user = userEvent.setup(); render(<SecretaryChat flowEnabled {...props} />);
  await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user;
}

describe('what a spoken answer to the confirmation means', () => {
  it('only a clear confirmation word confirms; a refusal never does; a bare yes is not enough', () => {
    for (const text of ['confirma', 'Confirma.', 'pode confirmar', 'sim, confirma', 'confirmado', 'Confirmar']) expect(voiceConfirmIntent(text), text).toBe('confirm');
    for (const text of ['não', 'Não confirma', 'cancela', 'volta', 'espera aí', 'para']) expect(voiceConfirmIntent(text), text).toBe('cancel');
    for (const text of ['sim', 'Ok.', 'pode', 'isso']) expect(voiceConfirmIntent(text), text).toBe('bare');
    for (const text of ['na verdade às 11', 'dia 13 às 9h', 'confirma não']) expect(voiceConfirmIntent(text), text).toBe('other');
  });
});

describe('hands-free listening', () => {
  it('counts as heard only after real speech, and measures the silence after it (2 s ends the answer)', () => {
    const pause = createPauseDetector();
    for (let i = 0; i < 40; i++) pause.push(0.002, 50); // 2 s of room noise: nothing heard
    expect(pause.heard).toBe(false);
    for (let i = 0; i < 10; i++) pause.push(0.2, 50); // half a second of voice
    expect(pause.heard).toBe(true); expect(pause.silentFor).toBe(0);
    for (let i = 0; i < 40; i++) pause.push(0.002, 50);
    expect(pause.silentFor).toBeGreaterThanOrEqual(HANDS_FREE.endAfterMs);
  });
});

describe('flow window', () => {
  it('an open question opens in the window; a typed answer there goes to that action', async () => {
    const user = await open(asking());
    const window = screen.getByRole('dialog');
    expect(within(window).getByText('Falta uma informação')).toBeVisible();
    expect(within(window).getByText('Para qual dia e horário devo passar Sérgio Antunes?')).toBeVisible();
    mocks.send.mockResolvedValue(ok(ready()));
    await user.type(within(window).getByLabelText('Responder digitando'), 'dia 12 às 10h');
    await user.click(within(window).getByRole('button', { name: 'Enviar resposta' }));
    expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'dia 12 às 10h', operation_ref: 'op-a' });
    // The next step is the confirmation, in the same window: one Confirmar on screen, never executed without it.
    const next = screen.getByRole('dialog');
    expect(within(next).getByText('Confira e confirme')).toBeVisible();
    expect(within(next).getByText(proposal.preview)).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Confirmar' })).toHaveLength(1);
    expect(mocks.group).not.toHaveBeenCalled();
    mocks.group.mockResolvedValue(ok(base));
    await user.click(within(next).getByRole('button', { name: 'Confirmar' }));
    expect(mocks.group).toHaveBeenCalledTimes(1);
  });
  it('voice: "confirma" shows what was heard and confirms after 3 s; Cancelar in between records nothing', async () => {
    const user = await open(ready(), { voiceEnabled: true });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Falar' }));
    hear('confirma');
    expect(screen.getByText(/Ouvi: “confirma”\. Confirmando em \d s…/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Confirmação cancelada. Nada foi gravado.')).toBeVisible();
    await new Promise(resolve => setTimeout(resolve, 3_300));
    expect(mocks.group).not.toHaveBeenCalled();
    mocks.group.mockResolvedValue(ok(base));
    await user.click(screen.getByRole('button', { name: 'Falar' }));
    hear('pode confirmar');
    await waitFor(() => expect(mocks.group).toHaveBeenCalledTimes(1), { timeout: 4_000 });
    expect(mocks.send).not.toHaveBeenCalled();
  }, 15_000);
  it('voice: "cancela" and a bare "sim" never confirm; anything else is sent to the action as a correction', async () => {
    const user = await open(ready(), { voiceEnabled: true });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Falar' }));
    // After each answer that is not sent, the microphone opens again by itself (a new recognition).
    const reopened = async () => { const before = Recognition.current; await waitFor(() => expect(Recognition.current).not.toBe(before)); };
    hear('cancela');
    expect(screen.getByText('Ok, não confirmei. Diga o que mudar, ou toque em Descartar.')).toBeVisible();
    await reopened();
    hear('sim');
    expect(screen.getByText('Para confirmar por voz, diga “confirma”.')).toBeVisible();
    await reopened();
    mocks.send.mockResolvedValue(ok(ready()));
    hear('na verdade às 11');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'na verdade às 11', operation_ref: 'op-a' }));
    expect(mocks.group).not.toHaveBeenCalled();
  });
  it('flag off: no question or confirmation window (the historical cards)', async () => {
    mocks.start.mockResolvedValue(ok(ready())); const user = userEvent.setup(); render(<SecretaryChat />);
    await user.click(screen.getByRole('button', { name: 'Nova conversa' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeVisible();
  });
});
