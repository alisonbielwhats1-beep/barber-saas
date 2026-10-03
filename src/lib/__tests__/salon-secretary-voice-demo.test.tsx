// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Voice for real use (owner decision of 03/10/2026): a dictation is added after the typed text and can be undone; the
 * recorder picks a container the server admits, stops by itself before the server's size cap and shows its time. Voice
 * still only fills the input box: it never sends or confirms. */
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), refresh: vi.fn(),
  suggest: vi.fn(), transcribe: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ startSecretary: mocks.start, sendSecretary: mocks.send, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, resumeSecretaryPlan: vi.fn(), selectSecretaryService: vi.fn(),
  selectSecretaryCustomer: vi.fn(), selectSecretaryOperation: vi.fn(), confirmSecretaryOperation: vi.fn(), suggestSecretaryDictation: mocks.suggest, transcribeSecretaryVoice: mocks.transcribe }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';
import { joinDictation, recorderMimeType, RECORDING_MAX_BYTES } from '../../app/(admin)/servicos/secretaria/use-secretary-voice';
import { TRANSCRIBE_SERVER } from '../secretary-transcribe';

class Recognition {
  static current: Recognition; lang = ''; continuous = false; interimResults = false;
  onstart?: () => void; onend?: () => void; onresult?: (e: unknown) => void; onerror?: (e: { error: string }) => void;
  constructor() { Recognition.current = this; } start() { this.onstart?.(); } stop() { this.onend?.(); } abort() {}
}
class Recorder {
  static current: Recorder; static supported = ['audio/mp4']; static isTypeSupported(type: string) { return Recorder.supported.includes(type); }
  state = 'inactive'; mimeType: string; timeslice?: number;
  ondataavailable: ((event: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null;
  constructor(public stream: unknown, public options: { mimeType?: string; audioBitsPerSecond?: number } = {}) { Recorder.current = this; this.mimeType = options.mimeType ?? 'audio/webm'; }
  start(timeslice?: number) { this.state = 'recording'; this.timeslice = timeslice; }
  /** A slice of `bytes` arrives, as the browser delivers one every `timeslice` ms. */
  slice(bytes: number) { this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }) }); }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['fim'], { type: this.mimeType }) }); this.onstop?.(); }
}
const track = { stop: vi.fn() };
function microphone() {
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) }, configurable: true });
  vi.stubGlobal('MediaRecorder', Recorder);
}
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('SpeechRecognition', Recognition); Recorder.supported = ['audio/mp4']; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'mediaDevices'); });

describe('pure parts', () => {
  it('a dictation joins after the typed text, never replaces it, within the 1000-character box', () => {
    expect(joinDictation('', '  remarca a Noemi  ')).toBe('remarca a Noemi');
    expect(joinDictation('Para sexta: ', 'cancela o Otávio')).toBe('Para sexta: cancela o Otávio');
    expect(joinDictation('texto digitado', '   ')).toBe('texto digitado');
    expect(joinDictation('x'.repeat(995), 'abcdefghij')).toHaveLength(1000);
  });
  it('the container is the first one the browser records among those the server admits', () => {
    expect(recorderMimeType({ isTypeSupported: type => type === 'audio/webm;codecs=opus' || type === 'audio/mp4' })).toBe('audio/webm;codecs=opus');
    expect(recorderMimeType({ isTypeSupported: type => type === 'audio/mp4' })).toBe('audio/mp4');
    expect(recorderMimeType({ isTypeSupported: () => false })).toBeUndefined();
    expect(recorderMimeType({})).toBeUndefined();
  });
  it('the recorder stops before the server cap, with room for the last slice', () => {
    expect(RECORDING_MAX_BYTES).toBeLessThan(TRANSCRIBE_SERVER.maxAudioBytes);
    expect(TRANSCRIBE_SERVER.maxAudioBytes - RECORDING_MAX_BYTES).toBeGreaterThanOrEqual(24_000);
  });
});

describe('dictation in the chat', () => {
  async function dictate(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    act(() => Recognition.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: text } }] }));
    await user.click(screen.getByRole('button', { name: 'Parar gravação' }));
  }
  it('adds the dictation after the typed text and offers to undo only that dictation', async () => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />);
    await user.type(screen.getByLabelText('Mensagem'), 'Na quinta:');
    await dictate(user, 'cancela o horário do Otávio');
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Na quinta: cancela o horário do Otávio');
    await user.click(screen.getByRole('button', { name: 'Desfazer ditado' }));
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Na quinta:');
    expect(screen.queryByRole('button', { name: 'Desfazer ditado' })).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('a second dictation is added too; once the owner edits the box, nothing is undone for them', async () => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />);
    await dictate(user, 'marca a Noemi amanhã');
    await dictate(user, 'às quatro da tarde');
    expect(screen.getByLabelText('Mensagem')).toHaveValue('marca a Noemi amanhã às quatro da tarde');
    expect(screen.getByRole('button', { name: 'Falar com a Secretária' })).toHaveTextContent('Falar');
    await user.type(screen.getByLabelText('Mensagem'), ' com a Lis');
    expect(screen.queryByRole('button', { name: 'Desfazer ditado' })).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('recorder of the GPT transcription', () => {
  it('records in a container the server admits, a slice per second, and shows the time', async () => {
    microphone(); mocks.transcribe.mockResolvedValue({ ok: true, text: 'bloqueia a agenda da Lis amanhã de manhã' });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ouvindo… 0:00'));
    expect(Recorder.current.options).toEqual({ mimeType: 'audio/mp4', audioBitsPerSecond: 24_000 }); expect(Recorder.current.timeslice).toBe(1000);
    await user.click(screen.getByRole('button', { name: 'Parar gravação' }));
    await waitFor(() => expect(screen.getByLabelText('Mensagem')).toHaveValue('bloqueia a agenda da Lis amanhã de manhã'));
    expect((mocks.transcribe.mock.calls[0][0] as FormData).get('audio')).toHaveProperty('type', 'audio/mp4');
    expect(screen.getByRole('status')).toHaveTextContent('Transcrição pronta. Revise antes de enviar.');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('stops by itself at the size limit, still transcribes what was said and says so', async () => {
    microphone(); mocks.transcribe.mockResolvedValue({ ok: true, text: 'remarca o Otávio para sexta' });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ouvindo'));
    act(() => { Recorder.current.slice(RECORDING_MAX_BYTES - 10); });
    expect(Recorder.current.state).toBe('recording');
    act(() => { Recorder.current.slice(20); });
    expect(Recorder.current.state).toBe('inactive');
    await waitFor(() => expect(screen.getByLabelText('Mensagem')).toHaveValue('remarca o Otávio para sexta'));
    expect(mocks.transcribe).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('A gravação chegou ao limite e foi encerrada. Revise antes de enviar.');
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.group).not.toHaveBeenCalled();
  });
  it('without isTypeSupported the browser default container is used', async () => {
    microphone(); const original = Recorder.isTypeSupported; Reflect.deleteProperty(Recorder, 'isTypeSupported');
    try {
      const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
      await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ouvindo'));
      expect(Recorder.current.options).toEqual({ audioBitsPerSecond: 24_000 });
    } finally { Object.defineProperty(Recorder, 'isTypeSupported', { value: original, configurable: true, writable: true }); }
  });
});
