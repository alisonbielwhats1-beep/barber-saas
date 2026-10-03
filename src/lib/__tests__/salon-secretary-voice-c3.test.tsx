// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SecretaryView } from '../salon-secretary';

/** C3 voice UI: correction suggestions after a dictation and the recorder path of GPT transcription. Both flags default
 * off; voice only fills the input box and never sends or confirms (the pinned voice contract). */
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), refresh: vi.fn(),
  suggest: vi.fn(), transcribe: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ startSecretary: mocks.start, startAndSendSecretary: async (input: object) => { const opened = await mocks.start(); return opened?.ok ? mocks.send({ ...input, sessionId: opened.state.sessionId }) : opened; }, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, resumeSecretaryPlan: vi.fn(), selectSecretaryService: vi.fn(),
  selectSecretaryCustomer: vi.fn(), selectSecretaryOperation: vi.fn(), confirmSecretaryOperation: vi.fn(), suggestSecretaryDictation: mocks.suggest, transcribeSecretaryVoice: mocks.transcribe }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';

const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
class Recognition {
  static current: Recognition; static created = 0; lang = ''; continuous = false; interimResults = false;
  onstart?: () => void; onend?: () => void; onresult?: (e: unknown) => void; onerror?: (e: { error: string }) => void;
  constructor() { Recognition.current = this; Recognition.created++; } start() { this.onstart?.(); } stop() { this.onend?.(); } abort() {}
}
class Recorder {
  static current: Recorder; state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(public stream: unknown) { Recorder.current = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) }); this.onstop?.(); }
}
const track = { stop: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks(); Recognition.created = 0;
  mocks.start.mockResolvedValue({ ok: true, state: base }); mocks.cancel.mockResolvedValue({ ok: true, state: { ...base, cancelled: true } });
  vi.stubGlobal('SpeechRecognition', Recognition);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'mediaDevices'); });
async function dictate(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
  act(() => Recognition.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: text } }] }));
  await user.click(screen.getByRole('button', { name: 'Parar gravação' }));
}

describe('voice correction suggestions (SALON_SECRETARY_VOICE_CORRECTION)', () => {
  it('off by default: a dictation asks for no correction', async () => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />);
    await dictate(user, 'bloqueia o rodrigues');
    expect(screen.getByLabelText('Mensagem')).toHaveValue('bloqueia o rodrigues');
    await act(async () => {});
    expect(mocks.suggest).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Correções sugeridas')).not.toBeInTheDocument();
  });
  it("offers 'rodrigues' → 'Rodrigo' in the input box; accepting only edits the text, and sending stays manual", async () => {
    mocks.suggest.mockResolvedValue({ ok: true, suggestions: [{ start: 11, end: 20, from: 'rodrigues', to: 'Rodrigo' }] });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled voiceCorrection />);
    await dictate(user, 'bloqueia o rodrigues');
    expect(mocks.suggest).toHaveBeenCalledExactlyOnceWith('bloqueia o rodrigues');
    await user.click(await screen.findByRole('button', { name: 'Trocar “rodrigues” por “Rodrigo”' }));
    expect(screen.getByLabelText('Mensagem')).toHaveValue('bloqueia o Rodrigo');
    expect(screen.queryByLabelText('Correções sugeridas')).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
    mocks.send.mockResolvedValue({ ok: true, state: base });
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', message: 'bloqueia o Rodrigo' });
  });
  it('the owner can keep the text as dictated, and any edit withdraws stale suggestions', async () => {
    mocks.suggest.mockResolvedValue({ ok: true, suggestions: [{ start: 11, end: 20, from: 'rodrigues', to: 'Rodrigo' }] });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled voiceCorrection />);
    await dictate(user, 'bloqueia o rodrigues');
    await user.click(await screen.findByRole('button', { name: 'Manter como está' }));
    expect(screen.getByLabelText('Mensagem')).toHaveValue('bloqueia o rodrigues'); expect(screen.queryByLabelText('Correções sugeridas')).not.toBeInTheDocument();
    cleanup(); render(<SecretaryChat voiceEnabled voiceCorrection />);
    await dictate(user, 'bloqueia o rodrigues');
    await screen.findByLabelText('Correções sugeridas');
    await user.type(screen.getByLabelText('Mensagem'), ' às 10');
    expect(screen.queryByLabelText('Correções sugeridas')).not.toBeInTheDocument(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('a failed correction request leaves the transcript untouched and silent', async () => {
    mocks.suggest.mockRejectedValue(Error('network'));
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled voiceCorrection />);
    await dictate(user, 'bloqueia o rodrigues'); await act(async () => {});
    expect(screen.getByLabelText('Mensagem')).toHaveValue('bloqueia o rodrigues'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('recorder path of GPT transcription (SALON_SECRETARY_TRANSCRIBE_ENABLED)', () => {
  function microphone() {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    vi.stubGlobal('MediaRecorder', Recorder);
    return getUserMedia;
  }
  it('records, transcribes through the server action and fills the input box without sending; the browser recognizer is not used', async () => {
    const getUserMedia = microphone();
    mocks.transcribe.mockResolvedValue({ ok: true, text: 'bloqueia o Rodrigo amanhã das 10 às 11' });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    expect(screen.getByText('A gravação é transcrita pelo serviço da Secretária. Revise o texto antes de enviar.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ouvindo'));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true }); expect(Recognition.created).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Parar gravação' }));
    await waitFor(() => expect(screen.getByLabelText('Mensagem')).toHaveValue('bloqueia o Rodrigo amanhã das 10 às 11'));
    const form = mocks.transcribe.mock.calls[0][0] as FormData;
    expect(form.get('audio')).toBeInstanceOf(Blob); expect(Number(form.get('seconds'))).toBeGreaterThan(0); expect(Number(form.get('seconds'))).toBeLessThanOrEqual(60);
    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Transcrição pronta. Revise antes de enviar.');
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('a refused transcription is visible and preserves the typed text', async () => {
    microphone();
    mocks.transcribe.mockResolvedValue({ ok: false, code: 'TRANSCRIBE_BUDGET', error: 'O limite de gasto da transcrição foi atingido. Você pode digitar.' });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await user.type(screen.getByLabelText('Mensagem'), 'Preserve');
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ouvindo'));
    await user.click(screen.getByRole('button', { name: 'Parar gravação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('limite de gasto');
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Preserve'); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('cancel discards the recording without transcribing', async () => {
    microphone();
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ouvindo'));
    await user.click(screen.getByRole('button', { name: 'Cancelar gravação' }));
    expect(mocks.transcribe).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Falar com a Secretária' })).toBeEnabled();
  });
  it('without a recorder in the browser there is an explicit typed fallback', async () => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    expect(screen.getByText('Gravação indisponível neste navegador. Use o campo de mensagem.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    expect(screen.getByRole('alert')).toHaveTextContent('não está disponível'); expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it('with the flag off the native recognizer stays the voice path', async () => {
    microphone();
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />);
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    expect(Recognition.created).toBe(1); expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});
