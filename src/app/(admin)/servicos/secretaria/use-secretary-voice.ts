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
export type VoiceState = 'idle' | 'listening' | 'processing' | 'ready';

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
type TranscribeReply = { ok: true; text: string } | { ok: false; error: string; code?: string };
/** C3, GPT transcription (ready but off): records with MediaRecorder and hands the audio to the server action. Same
 * contract as the native adapter: the transcript only fills the input box; nothing is sent or confirmed. */
export function useSecretaryRecorder(onTranscript: (text: string) => void, onError: (message: string) => void, transcribe?: (form: FormData) => Promise<TranscribeReply>) {
  const [phase, setPhase] = useState<VoiceState>('idle');
  const [supported, setSupported] = useState(false);
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const generation = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const callbacks = useRef({ onTranscript, onError, transcribe });
  callbacks.current = { onTranscript, onError, transcribe };
  const release = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined; };
  const cancel = useCallback(() => {
    generation.current++; clearTimeout(timeout.current);
    try { if (recorder.current?.state === 'recording') recorder.current.stop(); } catch { /* already stopped */ }
    recorder.current = undefined; stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined; setPhase('idle');
  }, []);
  useEffect(() => {
    setSupported(Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined');
    return cancel;
  }, [cancel]);
  async function begin() {
    cancel();
    const current = generation.current, live = () => current === generation.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !callbacks.current.transcribe) {
      callbacks.current.onError('A gravação não está disponível neste navegador. Você pode digitar.'); return;
    }
    setPhase('processing');
    let media: MediaStream;
    try { media = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { if (live()) { setPhase('idle'); callbacks.current.onError('Microfone não autorizado. Permita o acesso no navegador ou digite sua mensagem.'); } return; }
    if (!live()) { media.getTracks().forEach(track => track.stop()); return; }
    stream.current = media;
    // 24 kbit/s keeps a minute near 180 KB: the server bounds the billed length from the file size (secretary-transcribe.ts).
    const chunks: Blob[] = [], active = new MediaRecorder(media, { audioBitsPerSecond: 24_000 });
    let started = 0;
    recorder.current = active;
    active.ondataavailable = event => { if (live() && event.data?.size) chunks.push(event.data); };
    active.onstop = () => {
      if (!live()) return;
      clearTimeout(timeout.current); recorder.current = undefined; release();
      const audio = new Blob(chunks, { type: active.mimeType || 'audio/webm' });
      if (!audio.size) { setPhase('idle'); callbacks.current.onError('Nenhuma fala foi gravada. Grave novamente ou digite.'); return; }
      const form = new FormData();
      form.set('audio', audio, 'audio'); form.set('seconds', String(Math.min(RECORDING_MAX_SECONDS, Math.max(0.1, (Date.now() - started) / 1000))));
      setPhase('processing');
      callbacks.current.transcribe!(form).then(reply => {
        if (!live()) return;
        if (!reply.ok) { setPhase('idle'); callbacks.current.onError(reply.error); return; }
        callbacks.current.onTranscript(reply.text.slice(0, 1000)); setPhase('ready');
      }, () => { if (live()) { setPhase('idle'); callbacks.current.onError('A transcrição está indisponível por conexão. Seu texto foi preservado; tente novamente ou digite.'); } });
    };
    try {
      active.start(); started = Date.now(); setPhase('listening');
      // The recording stops by itself at the admitted maximum; it is still only transcribed, never sent.
      timeout.current = setTimeout(() => { if (live() && active.state === 'recording') active.stop(); }, RECORDING_MAX_SECONDS * 1000);
    } catch { cancel(); callbacks.current.onError('Não foi possível iniciar o microfone. Confira a permissão ou digite.'); }
  }
  function stop() {
    if (recorder.current?.state !== 'recording') return;
    setPhase('processing'); recorder.current.stop();
  }
  return { phase, supported, start: () => { void begin(); }, stop, cancel };
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
