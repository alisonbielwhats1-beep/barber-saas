"use client";
import { useCallback, useEffect, useRef, useState } from 'react';

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
/** `requesting`: the recorder waits for the browser's microphone permission (nothing is recorded yet). */
export type VoiceState = 'idle' | 'requesting' | 'listening' | 'processing' | 'ready';
/** A dictation is added after what the box held when it started (never replaces typed text), within the 1000-character box. */
export function joinDictation(before: string, text: string) {
  const said = text.trim();
  return (!said ? before : before.trim() ? `${before.trimEnd()} ${said}` : said).slice(0, 1000);
}

/** Voice is an input adapter only. It never sends a message or confirms an action. */
export function useSecretaryVoice(onTranscript: (text: string) => void, onError: (message: string) => void) {
  const [phase, setPhase] = useState<VoiceState>('idle');
  const [supported, setSupported] = useState(false);
  const active = useRef<Recognition>();
  const generation = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const callbacks = useRef({ onTranscript, onError });
  callbacks.current = { onTranscript, onError };
  const cancel = useCallback(() => {
    generation.current++; clearTimeout(timeout.current);
    active.current?.abort(); active.current = undefined; setPhase('idle');
  }, []);
  useEffect(() => {
    const browser = window as SpeechWindow;
    setSupported(Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition));
    return cancel;
  }, [cancel]);
  function start() {
    cancel();
    const browser = window as SpeechWindow, Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) { callbacks.current.onError('A transcrição não está disponível neste navegador. Você pode digitar.'); return; }
    const current = generation.current, recognition = new Constructor();
    let text = '', failed = false;
    active.current = recognition; recognition.lang = 'pt-BR'; recognition.continuous = false; recognition.interimResults = true;
    recognition.onstart = () => { if (current === generation.current) setPhase('listening'); };
    recognition.onresult = event => {
      if (current !== generation.current) return;
      text = Array.from(event.results).map(result => result[0].transcript).join(' ').slice(0, 1000);
      callbacks.current.onTranscript(text);
    };
    recognition.onerror = event => {
      if (current !== generation.current) return;
      failed = true; setPhase('idle'); clearTimeout(timeout.current);
      const errors: Record<string, string> = {
        'not-allowed': 'Microfone não autorizado. Permita o acesso no navegador ou digite sua mensagem.',
        'service-not-allowed': 'O navegador não disponibilizou a transcrição. Você pode digitar.',
        'audio-capture': 'Não foi possível acessar o microfone. Confira o dispositivo ou digite.',
        'no-speech': 'Não ouvi uma fala. Tente gravar novamente ou digite.',
        network: 'A transcrição está indisponível por conexão. Seu texto foi preservado; tente novamente ou digite.',
      };
      if (event.error !== 'aborted') callbacks.current.onError(errors[event.error] ?? 'Não foi possível transcrever. Tente novamente ou digite.');
    };
    recognition.onend = () => {
      if (current !== generation.current) return;
      active.current = undefined; clearTimeout(timeout.current);
      setPhase(!failed && text.trim() ? 'ready' : 'idle');
      if (!failed && !text.trim()) callbacks.current.onError('Nenhuma transcrição foi recebida. Grave novamente ou digite.');
    };
    try {
      setPhase('processing'); recognition.start();
      timeout.current = setTimeout(() => {
        if (current !== generation.current) return;
        recognition.stop(); setPhase('processing');
        timeout.current = setTimeout(() => { cancel(); callbacks.current.onError('A transcrição demorou demais. O texto disponível foi preservado.'); }, 15000);
      }, 45000);
    } catch { cancel(); callbacks.current.onError('Não foi possível iniciar o microfone. Confira a permissão ou digite.'); }
  }
  function stop() {
    if (!active.current) return;
    clearTimeout(timeout.current); setPhase('processing'); active.current.stop();
    timeout.current = setTimeout(() => { cancel(); callbacks.current.onError('A transcrição demorou demais. Você pode revisar o texto disponível.'); }, 15000);
  }
  return { phase, supported, start, stop, cancel };
}

export const RECORDING_MAX_SECONDS = 60;
/** Client stop before the server's 480 KB cap (secretary-transcribe.ts TRANSCRIBE_SERVER.maxAudioBytes; a test keeps it below):
 * Safari may ignore the bitrate hint, so the recorder counts the bytes it receives and stops by itself in time. */
export const RECORDING_MAX_BYTES = 440_000;
/** An unanswered permission prompt never settles getUserMedia, and a stuck request never answers: both give up with a message. */
export const MIC_PERMISSION_TIMEOUT_MS = 15_000;
export const TRANSCRIBE_TIMEOUT_MS = 45_000;
/** The first container the browser records, all admitted by the server: WebM/Opus (Chrome, Edge, Android), MP4/AAC (Safari,
 * iPhone), Ogg/Opus (Firefox). None supported or no isTypeSupported: the browser's default. */
const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'] as const;
export function recorderMimeType(recorder: { isTypeSupported?: (type: string) => boolean } | undefined = typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder) {
  return typeof recorder?.isTypeSupported === 'function' ? RECORDER_TYPES.find(type => recorder.isTypeSupported!(type)) : undefined;
}
type TranscribeReply = { ok: true; text: string } | { ok: false; error: string; code?: string };
/** Live transcription (owner, 04/10: "transcrição em tempo real enquanto eu falo"): the speech is cut at each pause and every
 * piece is transcribed while the owner keeps speaking, so the text appears as they talk and Enter only waits for the last
 * piece. Times in ms: `pollMs` between level readings; a piece ends after `minSpeechMs` of speech followed by a `pauseMs`
 * pause, by a `longPauseMs` pause once it is `longMs` long, or at `maxMs`. */
export const LIVE_PIECES = { pollMs: 50, pauseMs: 700, minSpeechMs: 300, longMs: 12_000, longPauseMs: 250, maxMs: 20_000 } as const;
/** Pause detection from the microphone level (RMS, 0–1). Speech is a level well above the room's floor (the quietest reading of
 * the last 3 s) or near the loudest one, so a dryer or a fan humming under the voice is a pause, not speech. Pure: the
 * recorder feeds it one reading per `pollMs`. */
export function createPauseDetector(options: typeof LIVE_PIECES = LIVE_PIECES) {
  const recent: number[] = [], span = Math.round(3000 / options.pollMs);
  let speech = 0, quiet = 0, length = 0;
  return {
    /** One reading lasting `ms`; true ends the current piece (its counters start again for the next one). */
    push(level: number, ms: number) {
      recent.push(level); if (recent.length > span) recent.shift();
      const floor = Math.min(...recent), peak = Math.max(...recent);
      length += ms;
      if (level > 0.01 && (level > floor * 2.5 || level >= peak * 0.5)) { speech += ms; quiet = 0; } else quiet += ms;
      const end = speech >= options.minSpeechMs && (quiet >= options.pauseMs || (length >= options.longMs && quiet >= options.longPauseMs) || length >= options.maxMs);
      if (end) { speech = 0; quiet = 0; length = 0; }
      return end;
    },
    /** The current piece holds speech (only silence after what was said is never sent). */
    get spoken() { return speech >= 100; },
  };
}
type AudioWindow = Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
/** C3, GPT transcription: records with MediaRecorder and hands the audio to the server action, a piece at each pause (above).
 * Each piece is a complete file the server admits, reserved and billed on its own; no audio is sent twice. Without Web Audio
 * (no pause detection) the whole recording is one piece, as before. Same contract as the native adapter: the transcript only
 * fills the input box; nothing is sent or confirmed here. `elapsed` (seconds) feeds the "Ouvindo… 0:12" line; `limited` says
 * the recording was stopped at its time or size limit. */
export function useSecretaryRecorder(onTranscript: (text: string) => void, onError: (message: string) => void, transcribe?: (form: FormData) => Promise<TranscribeReply>) {
  const [phase, setPhase] = useState<VoiceState>('idle');
  const [supported, setSupported] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [limited, setLimited] = useState(false);
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const audio = useRef<AudioContext>();
  const finish = useRef<() => void>();
  const generation = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const ticker = useRef<ReturnType<typeof setInterval>>();
  const monitor = useRef<ReturnType<typeof setInterval>>();
  const callbacks = useRef({ onTranscript, onError, transcribe });
  callbacks.current = { onTranscript, onError, transcribe };
  /** The microphone is let go as soon as the recording ends (pieces may still be transcribing). */
  const release = useCallback(() => {
    clearInterval(ticker.current); clearInterval(monitor.current);
    void audio.current?.close().catch(() => undefined); audio.current = undefined;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined;
  }, []);
  const cancel = useCallback(() => {
    generation.current++; clearTimeout(timeout.current); finish.current = undefined;
    try { if (recorder.current?.state === 'recording') recorder.current.stop(); } catch { /* already stopped */ }
    recorder.current = undefined; release(); setPhase('idle'); setElapsed(0);
  }, [release]);
  useEffect(() => {
    setSupported(Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined');
    return cancel;
  }, [cancel]);
  async function begin() {
    cancel(); setLimited(false);
    const current = generation.current, live = () => current === generation.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !callbacks.current.transcribe) {
      callbacks.current.onError('A gravação não está disponível neste navegador. Você pode digitar.'); return;
    }
    setPhase('requesting');
    let media: MediaStream, waiting: ReturnType<typeof setTimeout> | undefined;
    const asked = navigator.mediaDevices.getUserMedia({ audio: true });
    const unanswered = new Promise<never>((_, reject) => { waiting = setTimeout(() => reject(Error('MIC_PERMISSION_TIMEOUT')), MIC_PERMISSION_TIMEOUT_MS); });
    try { media = await Promise.race([asked, unanswered]); }
    catch (error) {
      // A late answer still releases the microphone.
      void asked.then(late => late.getTracks().forEach(track => track.stop()), () => undefined);
      if (live()) {
        setPhase('idle');
        callbacks.current.onError(error instanceof Error && error.message === 'MIC_PERMISSION_TIMEOUT'
          ? 'O navegador não liberou o microfone. Permita o acesso no aviso ao lado do endereço e toque em Falar de novo, ou digite.'
          : 'Microfone não autorizado. Permita o acesso no navegador ou digite sua mensagem.');
      }
      return;
    } finally { clearTimeout(waiting); }
    if (!live()) { media.getTracks().forEach(track => track.stop()); return; }
    stream.current = media;
    // 24 kbit/s keeps a minute near 180 KB: the server bounds the billed length from the file size (secretary-transcribe.ts).
    const mimeType = recorderMimeType();
    /** Each piece in speaking order; `done` once its transcription answered (text, nothing heard, or a failure). */
    const pieces: { done: boolean; text?: string; error?: string; empty?: boolean }[] = [];
    let started = 0, total = 0, stopping = false, recording: MediaRecorder | undefined;
    let detector: ReturnType<typeof createPauseDetector> | undefined;
    const dropped = new WeakSet<MediaRecorder>();
    // The text grows in speaking order: a later piece shows once the ones before it answered.
    const publish = () => {
      let text = '';
      for (const piece of pieces) { if (!piece.done) break; if (piece.text) text = joinDictation(text, piece.text); }
      if (text) callbacks.current.onTranscript(text.slice(0, 1000));
    };
    // Ready once the recording ended and every piece answered; any failure keeps the text in the box and sends nothing.
    const settle = () => {
      if (!live() || !stopping || recording || pieces.some(piece => !piece.done)) return;
      clearTimeout(timeout.current); finish.current = undefined; recorder.current = undefined; release();
      const failed = pieces.find(piece => piece.error && !piece.empty);
      if (failed) { setPhase('idle'); callbacks.current.onError(failed.error!); return; }
      if (!pieces.some(piece => piece.text)) {
        setPhase('idle'); callbacks.current.onError(pieces.at(-1)?.error ?? 'Nenhuma fala foi gravada. Grave novamente ou digite.'); return;
      }
      setPhase('ready');
    };
    const transcribePiece = (piece: Blob, seconds: number) => {
      const index = pieces.push({ done: false }) - 1, form = new FormData();
      form.set('audio', piece, 'audio'); form.set('seconds', String(Math.min(RECORDING_MAX_SECONDS, Math.max(0.1, seconds))));
      let late: ReturnType<typeof setTimeout> | undefined;
      const unanswered = new Promise<never>((_, reject) => { late = setTimeout(() => reject(Error('TRANSCRIBE_TIMEOUT')), TRANSCRIBE_TIMEOUT_MS); });
      Promise.race([callbacks.current.transcribe!(form), unanswered]).then(reply => {
        if (!live()) return;
        pieces[index] = reply.ok ? { done: true, text: reply.text.trim() } : { done: true, error: reply.error, empty: reply.code === 'TRANSCRIBE_EMPTY' };
        publish();
      }, error => {
        if (!live()) return;
        pieces[index] = { done: true, error: error instanceof Error && error.message === 'TRANSCRIBE_TIMEOUT'
          ? 'A transcrição demorou demais. Seu texto foi preservado; tente de novo ou digite.'
          : 'A transcrição está indisponível por conexão. Seu texto foi preservado; tente novamente ou digite.' };
      }).finally(() => { clearTimeout(late); settle(); });
    };
    /** Ends a piece; `keep` false drops it (silence after what was said). */
    const endPiece = (piece: MediaRecorder, keep: boolean) => {
      if (!keep) dropped.add(piece);
      try { if (piece.state === 'recording') piece.stop(); } catch { /* already stopped */ }
    };
    const startPiece = () => {
      const chunks: Blob[] = [], began = Date.now(), piece = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24_000 });
      recording = piece; recorder.current = piece;
      piece.ondataavailable = event => {
        if (!live() || !event.data?.size) return;
        chunks.push(event.data); total += event.data.size;
        // The size limit stops it like the time limit: what was said so far is still transcribed, never sent.
        if (total >= RECORDING_MAX_BYTES && !stopping) { setLimited(true); finish.current?.(); }
      };
      piece.onstop = () => {
        if (!live()) return;
        if (recording === piece) recording = undefined;
        if (stopping) release();
        const file = new Blob(chunks, { type: piece.mimeType || mimeType || 'audio/webm' });
        if (!dropped.has(piece) && file.size) transcribePiece(file, (Date.now() - began) / 1000);
        settle();
      };
      // A slice every second lets the size limit act during the recording.
      piece.start(1000);
    };
    finish.current = () => {
      if (!live() || stopping) return;
      stopping = true; clearTimeout(timeout.current); clearInterval(monitor.current); setPhase('processing');
      // The last piece goes unless it holds only the silence after what was already sent.
      if (recording) endPiece(recording, !detector || detector.spoken || pieces.length === 0); else settle();
    };
    try {
      startPiece(); started = Date.now(); setElapsed(0); setPhase('listening');
      ticker.current = setInterval(() => { if (live()) setElapsed(Math.min(RECORDING_MAX_SECONDS, Math.floor((Date.now() - started) / 1000))); }, 250);
      // The recording stops by itself at the admitted maximum; it is still only transcribed, never sent.
      timeout.current = setTimeout(() => { if (live()) { setLimited(true); finish.current?.(); } }, RECORDING_MAX_SECONDS * 1000);
    } catch { cancel(); callbacks.current.onError('Não foi possível iniciar o microfone. Confira a permissão ou digite.'); return; }
    // Pauses are read from the microphone level; without Web Audio the recording stays one piece.
    const Context = (window as AudioWindow).AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Context) return;
    try {
      const context = new Context(), analyser = context.createAnalyser();
      audio.current = context; analyser.fftSize = 1024; context.createMediaStreamSource(media).connect(analyser);
      void context.resume?.().catch(() => undefined);
      const samples = new Float32Array(analyser.fftSize), pause = createPauseDetector();
      detector = pause;
      monitor.current = setInterval(() => {
        if (!live() || stopping || !recording) return;
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        if (pause.push(Math.sqrt(energy / samples.length), LIVE_PIECES.pollMs)) { endPiece(recording, true); startPiece(); }
      }, LIVE_PIECES.pollMs);
    } catch { detector = undefined; }
  }
  function stop() {
    if (recorder.current?.state !== 'recording') return;
    finish.current?.();
  }
  return { phase, supported, elapsed, limited, start: () => { void begin(); }, stop, cancel };
}

/** Optional short speech, explicitly requested, using only installed local voices. */
export function speakSecretary(text: string) {
  if (!window.speechSynthesis) return false;
  const voice = window.speechSynthesis.getVoices().find(item => item.localService && item.lang.toLowerCase().startsWith('pt'));
  if (!voice || !text.trim() || text.length > 240) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text); utterance.voice = voice; utterance.lang = voice.lang;
  window.speechSynthesis.speak(utterance); return true;
}
