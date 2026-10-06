// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Voice for real use (owner decision of 03/10/2026): a dictation is added after the typed text and can be undone; the
 * recorder picks a container the server admits, stops by itself before the server's size cap and shows its time. Voice
 * still only fills the input box: it never sends or confirms. */
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), group: vi.fn(), readyGroups: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), refresh: vi.fn(),
  suggest: vi.fn(), transcribe: vi.fn(), startAndSend: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ startSecretary: mocks.start, sendSecretary: mocks.send,
  // The first message opens and sends in one request (recorded); the stand-in does what the server does, with the same mocks.
  startAndSendSecretary: async (input: object) => { mocks.startAndSend(input); const opened = await mocks.start(); return opened?.ok ? mocks.send({ ...input, sessionId: opened.state.sessionId }) : opened; }, confirmSecretary: mocks.confirm,
  confirmSecretaryGroup: mocks.group, confirmSecretaryReadyGroups: mocks.readyGroups, cancelSecretary: mocks.cancel, resumeSecretaryPlan: vi.fn(), selectSecretaryService: vi.fn(),
  selectSecretaryCustomer: vi.fn(), selectSecretaryOperation: vi.fn(), confirmSecretaryOperation: vi.fn(), suggestSecretaryDictation: mocks.suggest, transcribeSecretaryVoice: mocks.transcribe }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';
import { createPauseDetector, joinDictation, LIVE_PIECES, recorderMimeType, RECORDING_MAX_BYTES } from '../../app/(admin)/servicos/secretaria/use-secretary-voice';
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

describe('practical voice (owner, 03/10): Enter or Enviar sends what was said, Esc cancels, nothing hangs', () => {
  const base = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
  const reply = { ok: true, state: { ...base, message: 'Certo, vou ver.' } };
  beforeEach(() => { mocks.start.mockResolvedValue({ ok: true, state: base }); mocks.send.mockResolvedValue(reply); });
  async function recording(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ouvindo'));
  }
  it('Enter while speaking stops, transcribes and sends at once; the reply comes below', async () => {
    microphone(); mocks.transcribe.mockResolvedValue({ ok: true, text: 'remarca a Noemi para sexta às dez' });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await recording(user);
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'remarca a Noemi para sexta às dez' }));
    expect((await screen.findAllByText('Certo, vou ver.'))[0]).toBeVisible();
    expect(screen.getByLabelText('Mensagem')).toHaveValue('');
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('tapping Enviar while speaking does the same (one tap on the phone), after what was typed', async () => {
    microphone(); mocks.transcribe.mockResolvedValue({ ok: true, text: 'cancela o horário do Otávio' });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await user.type(screen.getByLabelText('Mensagem'), 'Hoje:');
    await recording(user);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'Hoje: cancela o horário do Otávio' }));
  });
  it('Esc while speaking cancels: nothing is transcribed or sent and the typed text comes back', async () => {
    microphone();
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await user.type(screen.getByLabelText('Mensagem'), 'Rascunho');
    await recording(user);
    await user.keyboard('{Escape}');
    expect(mocks.transcribe).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Rascunho');
    expect(screen.getByRole('button', { name: 'Falar com a Secretária' })).toBeEnabled();
  });
  it('a failed transcription sends nothing', async () => {
    microphone(); mocks.transcribe.mockResolvedValue({ ok: false, error: 'Nenhuma fala foi reconhecida. Grave novamente ou digite.' });
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await recording(user);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Nenhuma fala');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('on the text box Enter sends and Shift+Enter breaks the line; Ctrl+Espaço starts speaking', async () => {
    microphone();
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await user.type(screen.getByLabelText('Mensagem'), 'marca a Noemi{Shift>}{Enter}{/Shift}amanhã');
    expect(mocks.send).not.toHaveBeenCalled(); expect(screen.getByLabelText('Mensagem')).toHaveValue('marca a Noemi\namanhã');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'marca a Noemi\namanhã' }));
    await waitFor(() => expect(screen.getByLabelText('Mensagem')).toHaveValue(''));
    await user.keyboard('{Control>} {/Control}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ouvindo'));
    expect(screen.getByText(/Atalhos: Enter envia/)).toBeVisible();
  });
  it('the first message opens the conversation and is read in one request; the next ones only send', async () => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await user.type(screen.getByLabelText('Mensagem'), 'oi{Enter}');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'oi' }));
    expect(mocks.startAndSend).toHaveBeenCalledOnce(); expect(mocks.startAndSend).toHaveBeenCalledWith({ message: 'oi' });
    await waitFor(() => expect(screen.getByLabelText('Mensagem')).toHaveValue(''));
    await user.type(screen.getByLabelText('Mensagem'), 'marca a Noemi amanhã{Enter}');
    await waitFor(() => expect(mocks.send).toHaveBeenLastCalledWith({ sessionId: 'session', message: 'marca a Noemi amanhã' }));
    expect(mocks.startAndSend).toHaveBeenCalledOnce(); expect(mocks.start).toHaveBeenCalledOnce();
  });
});

describe('nothing hangs', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('an unanswered microphone prompt gives up after 15 s with a clear message', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(() => new Promise(() => undefined)) }, configurable: true });
    vi.stubGlobal('MediaRecorder', Recorder);
    render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await act(async () => { screen.getByRole('button', { name: 'Falar com a Secretária' }).click(); });
    expect(screen.getByRole('status')).toHaveTextContent('Permita o microfone no aviso do navegador');
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByRole('alert')).toHaveTextContent('O navegador não liberou o microfone');
    expect(screen.getByRole('button', { name: 'Falar com a Secretária' })).toBeEnabled();
  });
  it('a transcription that never answers gives up after 20 s and keeps the text', async () => {
    vi.useFakeTimers();
    microphone(); mocks.transcribe.mockReturnValue(new Promise(() => undefined));
    render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await act(async () => { screen.getByRole('button', { name: 'Falar com a Secretária' }).click(); });
    await act(async () => { screen.getByRole('button', { name: 'Parar gravação' }).click(); });
    expect(screen.getByRole('status')).toHaveTextContent('Transcrevendo');
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByRole('alert')).toHaveTextContent('A transcrição demorou demais');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('a browser that never reports the end of the recording still has it transcribed after 3 s (owner, 04/10)', async () => {
    vi.useFakeTimers();
    microphone(); mocks.transcribe.mockResolvedValue({ ok: true, text: 'bloqueia a agenda da Lis' });
    render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await act(async () => { screen.getByRole('button', { name: 'Falar com a Secretária' }).click(); });
    const silent = Recorder.current; silent.stop = () => { silent.state = 'inactive'; };
    act(() => silent.slice(3000));
    await act(async () => { screen.getByRole('button', { name: 'Parar gravação' }).click(); });
    expect(mocks.transcribe).not.toHaveBeenCalled(); expect(screen.getByRole('status')).toHaveTextContent('Transcrevendo');
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(mocks.transcribe).toHaveBeenCalledOnce();
    expect((mocks.transcribe.mock.calls[0][0] as FormData).get('audio')).toHaveProperty('size', 3000);
    expect(screen.getByLabelText('Mensagem')).toHaveValue('bloqueia a agenda da Lis'); expect(screen.getByRole('status')).toHaveTextContent('Transcrição pronta');
  });
  it('a wait shows how long it has lasted from the 2nd second: transcribing, then preparing the reply', async () => {
    vi.useFakeTimers();
    microphone(); mocks.start.mockResolvedValue({ ok: true, state: { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' } });
    let transcribed: (reply: { ok: true; text: string }) => void = () => undefined;
    mocks.transcribe.mockReturnValue(new Promise(resolve => { transcribed = resolve; })); mocks.send.mockReturnValue(new Promise(() => undefined));
    render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await act(async () => { screen.getByRole('button', { name: 'Falar com a Secretária' }).click(); });
    await act(async () => { screen.getByRole('button', { name: 'Enviar' }).click(); });
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByRole('status')).toHaveTextContent(/^Transcrevendo…$/);
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByRole('status')).toHaveTextContent('Transcrevendo… 3 s');
    await act(async () => { transcribed({ ok: true, text: 'oi' }); });
    expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'oi' });
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByRole('status')).toHaveTextContent('Entendendo e preparando… 2 s');
  });
});

/** Owner, 04/10: "transcrição em tempo real enquanto eu falo". The microphone level (Web Audio) cuts the speech at each pause and
 * every piece is transcribed while the owner keeps talking; Enter only waits for the last piece. */
describe('live transcription by pieces', () => {
  const read = (levels: [number, number][]) => { const pause = createPauseDetector(); const cuts: number[] = []; let at = 0;
    for (const [level, ms] of levels) for (let t = 0; t < ms; t += LIVE_PIECES.pollMs) { at += LIVE_PIECES.pollMs; if (pause.push(level, LIVE_PIECES.pollMs)) cuts.push(at); }
    return { cuts, spoken: pause.spoken }; };
  it('a pause after speech ends a piece; silence alone, a short breath or a steady hum never does', () => {
    expect(read([[0.002, 3000]]).cuts).toEqual([]);
    expect(read([[0.2, 1000], [0.002, 400], [0.2, 1000]]).cuts).toEqual([]);
    expect(read([[0.2, 1000], [0.002, 700]]).cuts).toEqual([1700]);
    expect(read([[0.04, 3000], [0.3, 1000], [0.04, 700]]).cuts).toEqual([4700]);
    expect(read([[0.2, 150], [0.002, 1000]]).cuts).toEqual([]);
  });
  it('a long stretch is cut at a short pause after 12 s, and at 20 s at the latest', () => {
    expect(read([[0.2, 12_100], [0.002, 300]]).cuts).toEqual([12_350]);
    expect(read([[0.2, 21_000]]).cuts).toEqual([20_000]);
  });
  it('only silence after what was said is not speech', () => {
    expect(read([[0.2, 1000], [0.002, 700], [0.002, 500]]).spoken).toBe(false);
    expect(read([[0.2, 1000], [0.002, 700], [0.2, 300]]).spoken).toBe(true);
  });

  let level = 0;
  class Audio {
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData(samples: Float32Array) { samples.fill(level); } }; }
    createMediaStreamSource() { return { connect() {} }; }
    resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
  }
  beforeEach(() => { vi.useFakeTimers(); level = 0; vi.stubGlobal('AudioContext', Audio);
    mocks.start.mockResolvedValue({ ok: true, state: { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' } });
    mocks.send.mockResolvedValue({ ok: true, state: { sessionId: 'session', cancelled: false, message: 'Certo, vou ver.' } }); });
  afterEach(() => { vi.useRealTimers(); });
  const speak = async (value: number, ms: number) => { level = value; await act(async () => { vi.advanceTimersByTime(ms); }); };
  it('each phrase is transcribed while the owner keeps talking and shows in the box; Enter waits only for the last one', async () => {
    microphone(); const said = ['Remarca a Noemi', 'para sexta às dez.'];
    mocks.transcribe.mockImplementation(async () => ({ ok: true, text: said.shift() }));
    render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await act(async () => { screen.getByRole('button', { name: 'Falar com a Secretária' }).click(); });
    await speak(0.25, 1200); await speak(0.002, 800);
    expect(mocks.transcribe).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Ouvindo'); expect(screen.getByRole('status')).toHaveTextContent('O texto aparece a cada pausa');
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Remarca a Noemi');
    await speak(0.25, 1000);
    await act(async () => { screen.getByRole('button', { name: 'Enviar' }).click(); });
    expect(mocks.transcribe).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(10); });
    expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'Remarca a Noemi para sexta às dez.' });
    expect(track.stop).toHaveBeenCalled();
  });
  it('the silence after the last phrase is never sent; a piece the provider heard nothing in is skipped', async () => {
    microphone(); mocks.transcribe.mockResolvedValueOnce({ ok: true, text: 'Cancela o horário do Otávio' })
      .mockResolvedValueOnce({ ok: false, code: 'TRANSCRIBE_EMPTY', error: 'Nenhuma fala foi reconhecida. Grave novamente ou digite.' });
    render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await act(async () => { screen.getByRole('button', { name: 'Falar com a Secretária' }).click(); });
    await speak(0.25, 1000); await speak(0.002, 800); await speak(0.25, 400); await speak(0.002, 800);
    expect(mocks.transcribe).toHaveBeenCalledTimes(2);
    await speak(0.002, 1500);
    await act(async () => { screen.getByRole('button', { name: 'Parar gravação' }).click(); });
    await act(async () => { vi.advanceTimersByTime(10); });
    expect(mocks.transcribe).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Cancela o horário do Otávio');
    expect(screen.getByRole('status')).toHaveTextContent('Transcrição pronta'); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('Esc while pieces are still transcribing drops them all and the typed text comes back', async () => {
    microphone(); mocks.transcribe.mockReturnValue(new Promise(() => undefined));
    render(<SecretaryChat voiceEnabled transcribeEnabled />);
    await act(async () => { screen.getByRole('button', { name: 'Falar com a Secretária' }).click(); });
    await speak(0.25, 1000); await speak(0.002, 800);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByLabelText('Mensagem')).toHaveValue(''); expect(screen.queryByRole('alert')).toBeNull(); expect(mocks.send).not.toHaveBeenCalled();
  });
});
