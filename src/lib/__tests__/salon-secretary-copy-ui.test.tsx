// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SecretaryView } from '../salon-secretary';
import { unknownExecutionMessage } from '../secretary-error-copy';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(),
  selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn(), discard: vi.fn(), option: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, selectSecretaryService: mocks.select,
  selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation, discardSecretaryAction: mocks.discard,
  selectSecretaryOption: mocks.option }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

/** UX-COPY / ERR-COPY on the screen (flag SALON_SECRETARY_COPY_V2, told by the server as `copyV2`): the review box only for a real
 * conflict, headed by its status; a refusal while understanding is that turn's reply; a confirmation's failure keeps its banner
 * and uncertain state. Without the marker, the historical screen. Estética fixture (limpeza de pele with Yara). */
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const review = (status: string) => ({ status, startLocal: '2026-10-02T15:00', endLocal: '2026-10-02T16:00', durationMin: 60, causes: [], conflicts: [], override_allowed: status === 'CONFLICT_OVERRIDABLE',
  missing_fields: status === 'AVAILABLE' ? [] : ['override_requested'], message: status === 'AVAILABLE' ? 'Horário disponível.' : 'Limpeza de pele vai até 16h e há outro atendimento às 15h30.', alternatives: [] });
const proposal = { proposal_ref: 'proposal', draft_revision: 1, preview: 'AGENDAR: Yara — Limpeza de pele\nsex, 02/10 às 15h', expires_at: '2099-01-01T00:00:00.000Z' };
const scheduled = (status: string, withProposal = false) => ({ ...base, skill: 'scheduling', message: 'Confira a proposta.',
  scheduling: { operation: 'appointment.create', fields: {}, message: '', metrics: {}, draft: { review: review(status) }, ...(withProposal ? { proposal } : {}) } }) as unknown as SecretaryView;
const reply = (state: SecretaryView, copyV2 = true) => ({ ok: true, state, ...(copyV2 ? { copyV2: true } : {}) });
beforeEach(() => { vi.resetAllMocks(); mocks.cancel.mockResolvedValue({ ok: true, state: { ...base, cancelled: true } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(first: ReturnType<typeof reply>) { mocks.start.mockResolvedValue(first); const user = userEvent.setup(); render(<SecretaryChat />); await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user; }

describe('the review box is driven by the status (copy on)', () => {
  it('AVAILABLE: no amber box and no "Atenção ao horário"; the proposal and Confirmar are still shown', async () => {
    await open(reply(scheduled('AVAILABLE', true)));
    expect(screen.queryByText('Atenção ao horário')).toBeNull(); expect(screen.queryByText('Horário disponível.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar agendamento' })).toBeTruthy();
  });
  it('OVERRIDABLE: "Horário com conflito" with the backend cause', async () => {
    await open(reply(scheduled('CONFLICT_OVERRIDABLE')));
    expect(screen.getByText('Horário com conflito')).toBeTruthy(); expect(screen.getByText(/há outro atendimento às 15h30/)).toBeTruthy();
    expect(screen.queryByText('Atenção ao horário')).toBeNull();
  });
  it('HARD_BLOCK: "Este horário não pode ser usado" and never a Confirmar button', async () => {
    await open(reply(scheduled('CONFLICT_HARD_BLOCK')));
    expect(screen.getByText('Este horário não pode ser usado')).toBeTruthy(); expect(screen.queryByRole('button', { name: /^Confirmar/ })).toBeNull();
  });
  it('copy off (no marker): the historical heading, even for AVAILABLE', async () => {
    await open(reply(scheduled('AVAILABLE', true), false));
    expect(screen.getByText('Atenção ao horário')).toBeTruthy(); expect(screen.getByText('Horário disponível.')).toBeTruthy();
  });
});
describe('a refusal while understanding is the reply of that turn (copy on)', () => {
  const refusal = 'Não consegui ordenar essas ações com segurança. Nada foi alterado. Pode pedir uma de cada vez?';
  it('the error text is the Secretária bubble of the sent message; no red banner; the typed text stays in the box', async () => {
    const user = await open(reply(base));
    mocks.send.mockResolvedValue({ ok: false, code: 'INVALID_DEPENDENCY_GRAPH', error: refusal, copyV2: true });
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'passa a yara pra sexta e põe a lívia no lugar');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const log = screen.getByRole('log');
    expect(within(log).getByText('passa a yara pra sexta e põe a lívia no lugar')).toBeTruthy(); expect(within(log).getByText(refusal)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Mensagem' }) as HTMLTextAreaElement).value).toBe('passa a yara pra sexta e põe a lívia no lugar');
  });
  it('without the marker: the historical red banner only', async () => {
    const user = await open(reply(base, false));
    mocks.send.mockResolvedValue({ ok: false, code: 'INVALID_DEPENDENCY_GRAPH', error: refusal });
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'passa a yara pra sexta');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(screen.getByRole('alert').textContent).toBe(refusal); expect(within(screen.getByRole('log')).queryByText(refusal)).toBeNull();
  });
  it("a confirmation's unknown failure keeps the banner and the uncertain state ('Não presuma sucesso')", async () => {
    const user = await open(reply(scheduled('AVAILABLE', true)));
    mocks.confirm.mockResolvedValue({ ok: false, code: 'BACKEND_FAILURE', error: unknownExecutionMessage, copyV2: true });
    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }));
    expect(screen.getByRole('alert').textContent).toBe(unknownExecutionMessage);
    expect(screen.getByRole('button', { name: 'Verificar resultado' })).toBeTruthy();
    expect(within(screen.getByRole('log')).queryByText(unknownExecutionMessage)).toBeNull();
  });
});
