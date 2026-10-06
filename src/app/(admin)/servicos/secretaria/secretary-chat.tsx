"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mic, Square, Send, Volume2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SecretaryView } from '@/lib/salon-secretary';
import type { ConfirmationGroup, PlanAction } from '@everflair/salon-secretary';
import { acceptDictationSuggestion, actionDetails, actionSubject, actionTitle, candidatesOf, confirmationLabel, destinationFor, hasReceipt, humanMessage, legacyConfirmLabel,
  operationLabels, planReleasedAppointments, planSummary, proposalOf, rawProposalOf, proposalExpired, receiptOf, reviewOf, reviewHeading, statusLabels, viewForAction, linkedDiscard } from '@/lib/secretary-ui';
import type { DictationSuggestion } from '@/lib/secretary-voice-correction';
import { startSecretary, sendSecretary, startAndSendSecretary, selectSecretaryCustomer, selectSecretaryService, confirmSecretary,
  cancelSecretary, resumeSecretaryPlan, selectSecretaryOperation, confirmSecretaryOperation, confirmSecretaryGroup, confirmSecretaryReadyGroups,
  discardSecretaryAction, selectSecretaryOption, suggestSecretaryDictation, transcribeSecretaryVoice, sendSecretaryFeedback, currentSecretary, secretaryCredits, type SecretaryReply, type CurrentSecretaryReply, type CreditsReply } from './actions';
import { CreditsMeter, CreditsNotice } from '@/components/secretary/credits-bar';
import { joinDictation, speakSecretary, useSecretaryRecorder, useSecretaryVoice } from './use-secretary-voice';
import { formatLocal } from '@/lib/secretary-datetime-format';
import { ActionSummary } from './action-summary';
import './secretary-mobile.css';
import { VOICE_CONFIRM_DELAY_MS, voiceConfirmIntent } from '@/lib/secretary-voice-confirm';

/** B7 timeline: one entry per turn: the owner's words (absent for a click), the Secretary's reply and, for a request
 * later replaced, a read-only summary of its actions with their final statuses. Past turns never carry buttons or
 * cards; only the newest turn's plan is live (rendered below the conversation). */
type Turn = { id: number; user?: string; reply?: string; plan?: string; summary?: { label: string; items: string[]; final?: true } };
const count = (n: number) => `${n} ${n === 1 ? 'ação' : 'ações'}`;
/** Owner feedback limits (the server re-validates): the conversation text entries and each entry's length. */
const FEEDBACK_ENTRIES = 80, FEEDBACK_TEXT = 2000;

/** `voiceCorrection` (SALON_SECRETARY_VOICE_CORRECTION) offers directory-name corrections after a dictation;
 * `transcribeEnabled` (SALON_SECRETARY_TRANSCRIBE_ENABLED) records audio for the server transcription instead of the
 * browser's recognizer. Both default off; neither ever sends or confirms. `onNavigate` runs when the owner follows a
 * link out of the conversation (the dock closes: on mobile it keeps the rest of the app inert while open).
 * `feedbackEnabled` (SALON_SECRETARY_FEEDBACK, default off): "Não era isso" on the latest reply. `flowEnabled` (SALON_SECRETARY_FLOW_WINDOW,
 * default off; owner, 05/10/2026): the decision window also carries the open questions and the confirmation, with the microphone
 * reopened at each step of a conversation driven by voice and a spoken "confirma" (3 s, with Cancelar) as the Confirmar. */
export function SecretaryChat({ voiceEnabled = false, active = true, voiceCorrection = false, transcribeEnabled = false, feedbackEnabled = false, flowEnabled = false, onNavigate }: { voiceEnabled?: boolean; active?: boolean; voiceCorrection?: boolean; transcribeEnabled?: boolean; feedbackEnabled?: boolean; flowEnabled?: boolean; onNavigate?: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<SecretaryView>();
  const [viewTime,setViewTime]=useState(()=>Date.now());
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnIds = useRef(0);
  /** Owner feedback on the latest reply: the open box (turn id), its draft and the turns already rated. */
  const [feedback, setFeedback] = useState<{ turn: number; comment: string; transcript: boolean; sending?: boolean; error?: string }>();
  const [rated, setRated] = useState<number[]>([]);
  const [message, setMessage] = useState('');
  const [operationRef, setOperationRef] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'thinking' | 'executing' | null>(null);
  const [slow, setSlow] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  /** UX-COPY / ERR-COPY (flag SALON_SECRETARY_COPY_V2): the server says so on every reply (`copyV2`); off, the historical screen. */
  const [copyV2, setCopyV2] = useState(false);
  /** Owner 06/10: the prepaid requests left (SALON_SECRETARY_CREDITS_ENABLED); refreshed when the chat opens and after each message. */
  const [credits, setCredits] = useState<Extract<CreditsReply, { enabled: true }>>();
  const refreshCredits = async () => { try { const reply = await secretaryCredits(); if (reply.ok && reply.enabled) setCredits(reply); } catch { /* the bar is informative only */ } };
  /** Review 2b: the card whose discard would also take linked actions, waiting for the owner's confirmation. */
  const [discardAsk, setDiscardAsk] = useState<string>();
  /** Owner, 05/10: the decision window (open by default whenever a new choice is waited for) and the choices it last showed. */
  const [decisionOpen, setDecisionOpen] = useState(true);
  const seenDecisions = useRef('');
  const decisionWindow = useRef<HTMLDivElement>(null);
  /** Flow window: the conversation is driven by voice (the last answer was spoken), so each step reopens the microphone. */
  const handsFree = useRef(false);
  /** A spoken confirmation waiting its 3 s (Cancelar stops it), and the window's own short notes (what was heard, what to say). */
  const [countdown, setCountdown] = useState<{ group: string; until: number }>();
  const [flowNote, setFlowNote] = useState<string>();
  const [windowText, setWindowText] = useState('');
  const lock = useRef(false);
  /** D1: the latest open conversation is asked for once, when the chat first becomes active. */
  const reattach = useRef(false);
  const retry = useRef<() => Promise<SecretaryReply>>();
  const input = useRef<HTMLTextAreaElement>(null);
  const lastResult = useRef<HTMLDivElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const beforeVoice = useRef('');
  /** The box's text right after the latest dictation: "Desfazer ditado" is offered only while the box still holds exactly it. */
  const dictated = useRef('');
  // A dictation is added after the text that was in the box when it started (typed text is never replaced).
  const dictate = (text: string) => { const next = joinDictation(beforeVoice.current, text); dictated.current = next; setMessage(next); };
  const native = useSecretaryVoice(dictate, setError);
  const recorder = useSecretaryRecorder(dictate, setError, transcribeEnabled ? form => transcribeSecretaryVoice(form) : undefined);
  const voice = transcribeEnabled ? recorder : native;
  const [corrections, setCorrections] = useState<{ text: string; items: DictationSuggestion[] }>();
  const typed = useRef(message);
  typed.current = message;
  const cancelVoice = voice.cancel;
  const recording = voice.phase === 'requesting' || voice.phase === 'listening' || voice.phase === 'processing';
  /** Owner, 03/10: Enter (or Enviar) while speaking stops, transcribes and sends at once; the reply comes below. "Parar" still
   * leaves the transcript in the box for review. Nothing is ever confirmed by voice. */
  const sendAfterVoice = useRef(false);
  /** Owner, 03/10: a wait is visible. From the 2nd second the status shows how long the current wait has lasted (transcribing,
   * preparing, executing), so a slow step is seen, not guessed. */
  const waiting = voice.phase === 'processing' ? 'voice' : busy;
  const [waitSince, setWaitSince] = useState<number>();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!waiting) { setWaitSince(undefined); return; }
    setWaitSince(Date.now());
    const timer = setInterval(() => setTick(tick => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  const waited = waitSince ? Math.floor((Date.now() - waitSince) / 1000) : 0;
  const seconds = waited >= 2 ? ` ${waited} s` : '';
  /** Owner 06/10 (mobile): a touch screen has no Enter or Esc, so the listening hint names the buttons instead. */
  const [touch, setTouch] = useState(false), [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const pointer = window.matchMedia('(pointer: coarse)'), small = window.matchMedia('(max-width: 639px), (max-height: 500px)');
    const update = () => { setTouch(pointer.matches); setCompact(small.matches); };
    update(); pointer.addEventListener?.('change', update); small.addEventListener?.('change', update);
    return () => { pointer.removeEventListener?.('change', update); small.removeEventListener?.('change', update); };
  }, []);
  // The message box grows with what is written (the stylesheet bounds it): a short message takes one line of a phone's screen.
  useEffect(() => {
    const box = input.current;
    if (!box) return;
    const fit = () => { box.style.height = 'auto'; box.style.height = box.scrollHeight ? `${box.scrollHeight + box.offsetHeight - box.clientHeight}px` : ''; };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [message, active]);
  // The virtual keyboard opening or closing resizes the visual viewport: the newest message stays in view above the box.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const follow = () => threadEnd.current?.scrollIntoView?.({ block: 'end' });
    viewport.addEventListener('resize', follow);
    return () => viewport.removeEventListener('resize', follow);
  }, [active]);
  const closed = state?.cancelled || (state?.skill === 'auto' ? false : Boolean(state &&
    (state.operations?.length ? state.operations.every(op => receiptOf(op.state) || op.state.cancelled || op.state.financial?.status === 'DONE' || op.state.inventory?.status === 'DONE') : receiptOf(state))));
  const confirmationSuppressed = ['UNSUPPORTED','AMBIGUOUS','BLOCKED','CONVERSATION'].includes(state?.capability_status ?? '');
  const hasProposal = Boolean(state && !confirmationSuppressed && (proposalOf(state) || state.operations?.some(op => proposalOf(op.state))));
  useEffect(()=>{
    const deadlines=[state,...(state?.operations?.map(operation=>operation.state)??[])].flatMap(view=>{
      const expiry=view&&!receiptOf(view)?rawProposalOf(view)?.expires_at:undefined;
      const deadline=expiry?Date.parse(expiry):NaN;
      return Number.isFinite(deadline)&&deadline>viewTime?[deadline]:[];
    });
    if(!deadlines.length)return;
    const timer=setTimeout(()=>setViewTime(Date.now()),Math.min(2_147_483_647,Math.max(1,Math.min(...deadlines)-Date.now())));
    return()=>clearTimeout(timer);
  },[state,viewTime]);
  const expiredKeys=new Set(state?.action_plan?.actions.filter(action=>{
    const child=state&&viewForAction(state,action);
    return action.status!=='DONE'&&child&&proposalExpired(child.state,viewTime);
  }).map(action=>action.key)??[]);
  const expiryVisible=expiredKeys.size>0||Boolean(state&&proposalExpired(state,viewTime));
  // The newest turn is always the one in view (the thread grows downwards).
  useEffect(() => { threadEnd.current?.scrollIntoView?.({ block: 'end' }); }, [turns.length, state, busy]);
  useEffect(() => { if (!active) { cancelVoice(); window.speechSynthesis?.cancel(); } }, [active, cancelVoice]);
  // D1 (SALON_SECRETARY_PERSISTED_STATE): after a reload, a new tab or another server worker, the owner's latest open
  // conversation comes back as the server holds it. Outside the act() lock and only into an untouched chat: anything the
  // owner did meanwhile wins. Without persisted state the server answers null and nothing changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshed on open; each message refreshes it again.
  useEffect(() => { if (active) void refreshCredits(); }, [active]);
  useEffect(() => {
    if (!active || reattach.current) return;
    reattach.current = true;
    let pending: Promise<CurrentSecretaryReply> | undefined;
    try { pending = currentSecretary(); } catch { return; }
    void Promise.resolve(pending).then(reply => {
      if (!reply?.ok || !reply.state || lock.current || turnIds.current > 0) return;
      const view = reply.state;
      setState(view); setViewTime(Date.now()); setDirty(false); setCopyV2(reply.copyV2 === true);
      setTurns([{ id: ++turnIds.current, reply: humanMessage(view.message), plan: view.action_plan?.plan_ref,
        ...(view.action_plan ? { summary: { label: `Nesta etapa · ${count(view.action_plan.actions.length)}`, items: planSummary(view.action_plan, view) } } : {}) }]);
    }, () => undefined);
  }, [active]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);
  // C3: once a dictation is ready, ask the server for directory-name corrections of that exact text.
  useEffect(() => {
    if (!voiceCorrection || voice.phase !== 'ready' || !typed.current.trim() || sendAfterVoice.current) return;
    const text = typed.current;
    let live = true;
    suggestSecretaryDictation(text).then(reply => { if (live && reply.ok && reply.suggestions.length) setCorrections({ text, items: reply.suggestions }); }, () => undefined);
    return () => { live = false; };
  }, [voiceCorrection, voice.phase]);

  /** `turn`: the timeline entry this call answers (a sent message); a click answers in a new entry of its own. */
  async function act(fn: () => Promise<SecretaryReply>, kind: 'thinking' | 'executing' = 'thinking', withdraw = false, turn?: number) {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setSlow(false); setError('');
    if (withdraw) setDirty(true);
    if (kind === 'executing') retry.current = fn;
    const timer = setTimeout(() => setSlow(true), 20000);
    try {
      const reply = await fn();
      setCopyV2(reply.copyV2 === true);
      if (reply.ok) {
        setState(reply.state);setViewTime(Date.now());
        if (state?.action_plan?.plan_ref !== reply.state.action_plan?.plan_ref) setOperationRef(undefined);
        setDirty(false); setUncertain(false); retry.current = undefined;
        // An answer that could not be read is its notice alone: never beside the screen's own "ready" text.
        const own = reply.state.capability_status || reply.state.turn_notice_alone ? undefined : reply.state.action_plan?.status === 'DONE' ? 'Confira os resultados abaixo.'
          : reply.state.action_plan?.status === 'READY_FOR_CONFIRMATION' ? 'Preparei as ações. Confira os detalhes antes de confirmar.' : undefined;
        // B5: a part left out (or an answer not understood) is never hidden behind the screen's own text.
        const text = own === undefined ? humanMessage(reply.state.message) : reply.state.turn_notice ? `${humanMessage(reply.state.turn_notice)}\n\n${own}` : own;
        // A different plan replaces the live cards: the earlier request stays in the timeline, read-only and
        // collapsed, at the last turn that showed it, with its final statuses (a discard's retired plan: "descartada").
        const earlier = state?.action_plan && state.action_plan.plan_ref !== reply.state.action_plan?.plan_ref ?
          reply.state.retired_plan?.plan_ref === state.action_plan.plan_ref ? reply.state.retired_plan : state.action_plan : undefined;
        const final = earlier && { label: `Pedido anterior · ${count(earlier.actions.length)}`, items: planSummary(earlier, state), final: true as const };
        // Each turn keeps what its reply showed; it is displayed once the turn is past (read-only).
        const shownNow = reply.state.action_plan && { label: `Nesta etapa · ${count(reply.state.action_plan.actions.length)}`, items: planSummary(reply.state.action_plan, reply.state) };
        setTurns(previous => {
          const next = [...previous];
          let at = turn === undefined ? -1 : next.findIndex(item => item.id === turn);
          if (at < 0) { next.push({ id: ++turnIds.current }); at = next.length - 1; }
          next[at] = { ...next[at], reply: text, plan: reply.state.action_plan?.plan_ref, summary: shownNow || undefined };
          if (final && earlier) {
            const shown = next.slice(0, at).map(item => item.plan).lastIndexOf(earlier.plan_ref), owner = shown >= 0 ? shown : at - 1;
            next[owner >= 0 ? owner : at] = { ...next[owner >= 0 ? owner : at], summary: final };
          }
          return next;
        });
        if (kind === 'executing' && hasReceipt(reply.state)) router.refresh();
        if (kind === 'executing') requestAnimationFrame(() => lastResult.current?.focus());
        return reply.state;
      }
      // ERR-COPY (flag): a refusal while understanding a message (or a click) is that turn's own reply, never only a red banner;
      // a confirmation's failure keeps the banner and its uncertain state ("Não presuma sucesso").
      if (reply.copyV2 && kind === 'thinking') setTurns(previous => {
        const next = [...previous];
        let at = turn === undefined ? -1 : next.findIndex(item => item.id === turn);
        if (at < 0) { next.push({ id: ++turnIds.current }); at = next.length - 1; }
        next[at] = { ...next[at], reply: reply.error };
        return next;
      });
      else setError(reply.error);
      if (kind === 'executing' && reply.code === 'BACKEND_FAILURE') setUncertain(true);
      else { setDirty(true); setUncertain(false); retry.current = undefined; }
    } catch {
      setError(kind === 'executing' ? 'Não foi possível receber o resultado. Não presuma sucesso. Verifique usando a mesma confirmação.' : 'Falha de conexão. Seu texto foi preservado. Tente enviar novamente.');
      if (kind === 'executing') setUncertain(true);
    } finally { clearTimeout(timer); lock.current = false; setBusy(null); setSlow(false); }
  }
  async function begin() {
    voice.cancel(); setMessage(''); setOperationRef(undefined); setDirty(true);
    const next = await act(async () => {
      if (state && !state.cancelled && !closed) {
        const cancelled = await cancelSecretary(state.sessionId);
        if (!cancelled.ok && !['SESSION_NOT_FOUND', 'SESSION_CLOSED'].includes(cancelled.code ?? '')) return cancelled;
      }
      return startSecretary();
    }, 'thinking', true);
    // A new conversation starts a new timeline (the previous one is not carried over).
    if (next) {
      setTurns([{ id: ++turnIds.current, reply: humanMessage(next.message), plan: next.action_plan?.plan_ref,
        ...(next.action_plan ? { summary: { label: `Nesta etapa · ${count(next.action_plan.actions.length)}`, items: planSummary(next.action_plan, next) } } : {}) }]);
      setFeedback(undefined); setRated([]); input.current?.focus();
    }
  }
  /** `fromVoice`: the text came from the microphone (the flow window then keeps listening at its next step). */
  async function sendText(text: string, fromVoice = false) {
    if (!text.trim() || busy || recording || uncertain) return false;
    handsFree.current = fromVoice; setFlowNote(undefined);
    // Flow window: an answer given while a step is shown goes to that step's action (as "Alterar / responder a esta ação" does).
    const target = operationRef ?? (flowEnabled && decisionOpen ? flowOperation : undefined), turn = ++turnIds.current;
    setTurns(previous => [...previous, { id: turn, user: text }]); setFeedback(undefined);
    // The first message opens the conversation in the same request (one round trip instead of two; owner, 03/10).
    const result = await act(() => state ? sendSecretary({ sessionId: state.sessionId, message: text, ...(target ? { operation_ref: target } : {}) })
      : startAndSendSecretary({ message: text }), 'thinking', true, turn);
    void refreshCredits();
    return Boolean(result);
  }
  async function send(fromVoice = false) {
    if (await sendText(message, fromVoice)) setMessage('');
  }
  function edit(text: string) { setMessage(text); if (hasProposal) setDirty(true); }
  function startVoice() {
    if (busy || uncertain || recording) return;
    beforeVoice.current = message; setDirty(true); setError(''); setCorrections(undefined); voice.start();
  }
  function cancelRecording() { sendAfterVoice.current = false; voice.cancel(); setMessage(beforeVoice.current); }
  /** Enter or Enviar while the microphone is open: stop and send what was said (still waiting for permission: nothing to send). */
  function finishAndSend() {
    if (voice.phase === 'requesting') { cancelRecording(); return; }
    sendAfterVoice.current = true;
    if (voice.phase === 'listening') voice.stop();
  }
  // The transcript (added after what was typed) goes as soon as it is ready; a failed transcription sends nothing.
  const sendNow = useRef(send);
  sendNow.current = send;
  /** What a finished dictation does (assigned below, with the flow window's current step). */
  const voiceAnswer = useRef<() => void>(() => { void sendNow.current(true); });
  useEffect(() => {
    if (voice.phase === 'idle') sendAfterVoice.current = false;
    if (voice.phase !== 'ready' || !sendAfterVoice.current) return;
    sendAfterVoice.current = false; voiceAnswer.current();
  }, [voice.phase]);
  // Shortcuts while the panel is open: Enter sends what was said, Esc cancels the recording (the panel stays open), Ctrl+Espaço
  // starts speaking. On the text box, Enter sends and Shift+Enter breaks the line.
  const shortcuts = useRef({ recording, startVoice, cancelRecording, finishAndSend });
  shortcuts.current = { recording, startVoice, cancelRecording, finishAndSend };
  useEffect(() => {
    if (!active || !voiceEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      const keys = shortcuts.current;
      if (keys.recording && (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey))) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'Escape') keys.cancelRecording(); else keys.finishAndSend();
      } else if (!keys.recording && event.ctrlKey && event.code === 'Space') { event.preventDefault(); keys.startVoice(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, voiceEnabled]);
  // Accepting a correction only edits the input box; the owner still reviews and presses Enviar.
  function acceptCorrection(item: DictationSuggestion) {
    const next = corrections && corrections.text === message ? acceptDictationSuggestion(message, corrections.items, item) : undefined;
    if (!next) { setCorrections(undefined); return; }
    edit(next.text); setCorrections(next.items.length ? next : undefined); input.current?.focus();
  }
  function select(view: SecretaryView, ref: string, operation?: string) {
    if (!state) return;
    void act(() => operation ? selectSecretaryOperation(state.sessionId, operation, ref) : view.customer ? selectSecretaryCustomer(state.sessionId, ref) : selectSecretaryService(state.sessionId, ref), 'thinking', true);
  }
  // Until the reply to the newest message arrives, the previous request's cards are not shown under it.
  const newest = turns.at(-1);
  const awaitingReply = busy === 'thinking' && newest?.user !== undefined && newest.reply === undefined;
  const disabled = Boolean(busy || dirty || uncertain || recording || state?.cancelled || confirmationSuppressed);
  // The recorder counts its time ("Ouvindo… 0:12") and says when it stopped at its time or size limit.
  const elapsed = transcribeEnabled ? ` ${Math.floor(recorder.elapsed / 60)}:${String(recorder.elapsed % 60).padStart(2, '0')}` : '';
  const limited = transcribeEnabled && recorder.limited;
  const idleStatus = 'Fale ou escreva o que precisa';
  const status = busy === 'executing' ? `Executando…${seconds}` : busy ? `Entendendo e preparando…${seconds}` : voice.phase === 'requesting' ? 'Permita o microfone no aviso do navegador para começar.' : voice.phase === 'listening' ? `Ouvindo…${elapsed} ${transcribeEnabled ? 'O texto aparece a cada pausa. ' : ''}${touch ? 'Toque em Enviar para mandar ou em Parar para revisar antes.' : 'Enviar (ou Enter) manda; Esc cancela.'}` : voice.phase === 'processing' ? `Transcrevendo…${seconds}` : voice.phase === 'ready' && message ? limited ? 'A gravação chegou ao limite e foi encerrada. Revise antes de enviar.' : 'Transcrição pronta. Revise antes de enviar.' : uncertain ? 'Resultado ainda não verificado' : state?.cancelled ? 'Conversa encerrada' : state?.action_plan?.status === 'PARTIAL_FAILURE' ? 'Revise o resultado de cada ação' : closed || (state?.skill === 'auto' && state.action_plan?.status === 'DONE') ? 'Resultado confirmado pelo sistema' : expiryVisible ? 'Proposta expirada. Envie uma mensagem para preparar novamente.' : dirty && hasProposal ? 'Proposta anterior desatualizada' : hasProposal ? 'Confira antes de confirmar' : idleStatus;

  // B4: a backend-offered time slot is applied as a short answer and prepared again; it never confirms.
  function pickSlot(option: string, operation: string) {
    if (!state) return;
    void act(() => selectSecretaryOption(state.sessionId, operation, option, state.action_plan?.revision), 'thinking', true);
  }
  /** The choices a view waits for (which customer, appointment, service, half of the day; a backend-offered slot). */
  function choiceButtons(view: SecretaryView, operation?: string) {
    // Numbered like the question lists them, so "a segunda" / "opção 2" read naturally.
    const slots = operation ? view.options ?? [] : [];
    // D1: a learned alias proposes one entity, already highlighted; it is still only chosen by this click.
    const proposed = view.scheduling?.candidates?.source === 'alias';
    const exception = slots.filter(slot => slot.kind === 'exception'), times = slots.filter(slot => slot.kind !== 'exception');
    return <>
      {!!candidatesOf(view).length && <div aria-label="Opções encontradas" className="flex flex-col gap-2">
        {candidatesOf(view).map((candidate, index) => <Button key={candidate.id} variant={proposed && index === 0 ? 'default' : 'outline'} disabled={Boolean(busy || uncertain)} className="h-auto min-h-11 justify-start whitespace-normal text-left" onClick={() => select(view, candidate.id, operation)}>{`${index + 1}. ${candidate.label}`}</Button>)}
      </div>}
      {!!times.length && <div aria-label="Horários disponíveis" className="flex flex-col gap-2">
        {times.map((slot, index) => <Button key={slot.option_id} variant="outline" disabled={Boolean(busy || uncertain)} className="h-auto min-h-11 justify-start whitespace-normal text-left" onClick={() => pickSlot(slot.option_id, operation!)}>{`${index + 1}. ${slot.label}`}</Button>)}
      </div>}
      {/* 05/10: the schedule exception itself, apart and never focused on its own (Enter never authorizes it); Confirmar still follows. */}
      {!!exception.length && <div aria-label="Exceção de horário" className="flex flex-col gap-2">
        {exception.map(slot => <Button key={slot.option_id} variant="outline" disabled={Boolean(busy || uncertain)} className="h-auto min-h-11 justify-start whitespace-normal border-amber-500 text-left text-amber-700 dark:text-amber-300" onClick={() => pickSlot(slot.option_id, operation!)}>{slot.label}</Button>)}
      </div>}
    </>;
  }
  function options(view: SecretaryView, operation?: string) {
    // Owner, 05/10: while the decision window is open its choices are answered there, never twice on screen.
    const inWindow = decisionOpen && decisions.some(decision => (decision.operation ?? '') === (operation ?? ''));
    const slots = operation ? view.options ?? [] : [];
    return <>
      {inWindow ? <p className="text-[13px] text-muted-foreground">Escolha na janela de decisão aberta.</p> : choiceButtons(view, operation)}
      {reviewOf(view) && reviewHeading(reviewOf(view)!.status, copyV2) && <div className="border-l-2 border-amber-500 pl-3 text-sm">
        <strong>{reviewHeading(reviewOf(view)!.status, copyV2)}</strong>
        <p>{humanMessage(reviewOf(view)!.message)}</p>
        {reviewOf(view)!.alternatives.length > 0 && !slots.length && <p>Alternativas disponíveis: {reviewOf(view)!.alternatives.map(slot => formatLocal(slot.startLocal, state?.today)).join(', ')}.</p>}
      </div>}
    </>;
  }
  function confirmationBlocked(action: PlanAction) {
    const failures = ['FAILED_SAFE','UNSUPPORTED','DOMAIN_CONFLICT','BLOCKED_BY_DEPENDENCY'];
    // Missing fields can project a conflicting assessment as NEEDS_INPUT.
    // Preserve the underlying backend veto when deciding whether to offer confirmation.
    return failures.includes(action.status) || failures.includes(action.assessment.status) || action.assessment.issue === 'PROPOSAL_EXPIRED' || action.assessment.issue === 'REVIEW_REQUIRED';
  }
  const planAction = (key: string) => state!.action_plan!.actions.find(action => action.key === key)!;
  // A group gets its own Confirm only while no member is expired, vetoed or globally suppressed.
  const groupOffered = (group: ConfirmationGroup) => group.status !== 'DONE' && !state?.cancelled && !group.action_keys.some(key => expiredKeys.has(key)) &&
    !group.action_keys.some(key => confirmationBlocked(planAction(key))) && !confirmationSuppressed;
  const groupApproval = (group: ConfirmationGroup) => ({ plan_ref: state!.action_plan!.plan_ref, revision: state!.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint });
  const readyGroups = state?.action_plan?.confirmation_groups.filter(group => group.status === 'READY_FOR_CONFIRMATION' && groupOffered(group)) ?? [];
  const perComponent = state?.action_plan?.policy?.grouping === 'component';
  // Discarded actions left the plan's live cards (and its groups); they are only listed once archived.
  const liveActions = state?.action_plan?.actions.filter(action => action.status !== 'DISCARDED') ?? [];
  // C7 (review): a NEW booking's card never lists an appointment another action of this plan cancels or moves.
  const released = planReleasedAppointments(state);
  /** Owner, 05/10: every choice the Secretary waits for opens in one window above the conversation, one at a time ("Decisão 1 de
   * 2"); answered, the next one shows. Closed, a bar above the message box keeps them in reach. Nothing is ever confirmed there. */
  const decisions: { key: string; action?: PlanAction; view: SecretaryView; operation?: string }[] = !state || closed || state.cancelled || awaitingReply ? []
    : state.action_plan ? liveActions.flatMap(action => {
      const child = action.status === 'DONE' ? undefined : viewForAction(state, action);
      return child && (candidatesOf(child.state).length || child.state.options?.length) ? [{ key: action.key, action, view: child.state, operation: child.operation_ref }] : [];
    }) : (state.skill !== 'auto' || !!state.operations?.length) ? (state.operations ?? [{ operation_ref: '', state }]).flatMap(({ operation_ref, state: view }) =>
      !receiptOf(view) && !view.cancelled && candidatesOf(view).length ? [{ key: operation_ref || 'single', view, operation: operation_ref || undefined }] : []) : [];
  const decision = decisions[0];
  // A new question (other actions or other options) opens the window again, even after the owner closed it.
  const decisionKeys = decisions.map(item => `${item.key}:${candidatesOf(item.view).map(candidate => candidate.id).join(',')}:${(item.view.options ?? []).map(slot => slot.option_id).join(',')}`).join('|');
  /** Flow window (flowEnabled, owner 05/10/2026): with no choice waiting, the window also carries an open question of the plan
   * ("Para quando passo o Sérgio?") and then its one confirmation (the summary, Confirmar). One step at a time. */
  const openStep = flowEnabled && !decision && state?.action_plan && !closed && !state.cancelled && !awaitingReply && !confirmationSuppressed;
  const questionAction = openStep ? liveActions.find(action => action.status === 'NEEDS_INPUT' && action.missing_fields.length > 0 && !confirmationBlocked(action) && !expiredKeys.has(action.key)) : undefined;
  const questionChild = questionAction && state ? viewForAction(state, questionAction) : undefined;
  const confirmGroup = openStep && !questionAction && readyGroups.length === 1 && liveActions.every(action => action.status === 'DONE' || readyGroups[0].action_keys.includes(action.key)) ? readyGroups[0] : undefined;
  const confirmMembers = confirmGroup ? confirmGroup.action_keys.map(planAction).filter(action => action.status !== 'DONE') : [];
  const step: 'choice' | 'question' | 'confirm' | undefined = decision ? 'choice' : questionChild ? 'question' : confirmGroup ? 'confirm' : undefined;
  const flowOperation = decision ? decision.operation : questionChild ? questionChild.operation_ref : confirmMembers.length === 1 && state ? viewForAction(state, confirmMembers[0])?.operation_ref : undefined;
  const flowKey = `${decisionKeys}|${questionAction ? `q:${questionAction.key}:${state?.action_plan?.revision}` : ''}|${confirmGroup ? `c:${confirmGroup.fingerprint}` : ''}`;
  const hasStep = Boolean(step);
  useEffect(() => {
    if (hasStep && flowKey !== seenDecisions.current) { setDecisionOpen(true); setCountdown(undefined); }
    seenDecisions.current = hasStep ? flowKey : '';
  }, [flowKey, hasStep]);
  // The window takes the focus on its first option, so a choice is one key or one tap away.
  useEffect(() => {
    if (decisionOpen && decisionKeys) requestAnimationFrame(() => decisionWindow.current?.querySelector<HTMLButtonElement>('[aria-label="Opções encontradas"] button, [aria-label="Horários disponíveis"] button')?.focus());
  }, [decisionOpen, decisionKeys]);
  // Esc closes the window wherever the focus is (just reopened by "Responder", the focus is still on the bar), except in the
  // message box, and never during the confirmation countdown. A recording is cancelled first by the voice shortcut above.
  useEffect(() => {
    if (!decisionOpen || countdown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      setDecisionOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decisionOpen, countdown]);
  function answerByMessage() {
    if (decision?.operation) setOperationRef(decision.operation);
    setDirty(true); setDecisionOpen(false); input.current?.focus();
  }
  /** Hands-free listening for the window's step: the transcript is sent (or read as the confirmation) by itself after a pause. */
  function listen() {
    if (!voiceEnabled || busy || uncertain || recording || countdown) return;
    beforeVoice.current = ''; setMessage(''); setError(''); setCorrections(undefined); sendAfterVoice.current = true;
    if (transcribeEnabled) recorder.start({ handsFree: true }); else native.start();
  }
  const listenNext = useRef(listen);
  listenNext.current = listen;
  // Each new step of a conversation driven by voice opens the microphone again: the owner just keeps talking.
  useEffect(() => {
    if (!flowEnabled || !decisionOpen || !hasStep || !handsFree.current) return;
    const timer = setTimeout(() => listenNext.current(), 350);
    return () => clearTimeout(timer);
  }, [flowEnabled, decisionOpen, hasStep, flowKey]);
  const oneToConfirm = confirmMembers.length === 1;
  function confirmNow() {
    if (!state || !confirmGroup || busy || uncertain) return;
    voice.cancel(); sendAfterVoice.current = false; setCountdown(undefined); setFlowNote(undefined);
    const approval = groupApproval(confirmGroup);
    void act(() => confirmSecretaryGroup(state.sessionId, approval), 'executing');
  }
  const confirmLater = useRef(confirmNow);
  confirmLater.current = confirmNow;
  // A spoken "confirma" waits 3 s on screen (Cancelar stops it) before the same call the Confirmar button makes.
  useEffect(() => {
    if (!countdown) return;
    const tick = setInterval(() => setTick(value => value + 1), 250);
    const due = setTimeout(() => confirmLater.current(), Math.max(0, countdown.until - Date.now()));
    return () => { clearInterval(tick); clearTimeout(due); };
  }, [countdown]);
  voiceAnswer.current = () => {
    const heard = typed.current.trim();
    if (flowEnabled && decisionOpen && step === 'confirm' && confirmGroup) {
      const intent = voiceConfirmIntent(heard);
      if (intent !== 'other') { setMessage(''); setDirty(false); }
      if (intent === 'confirm') {
        if (oneToConfirm) { setFlowNote(`Ouvi: “${heard}”.`); setCountdown({ group: confirmGroup.key, until: Date.now() + VOICE_CONFIRM_DELAY_MS }); }
        else setFlowNote('Com mais de uma ação, toque em Confirmar.');
        return;
      }
      if (intent === 'cancel') { setFlowNote('Ok, não confirmei. Diga o que mudar, ou toque em Descartar.'); setTimeout(() => listenNext.current(), 300); return; }
      if (intent === 'bare') { setFlowNote('Para confirmar por voz, diga “confirma”.'); setTimeout(() => listenNext.current(), 300); return; }
    }
    void sendNow.current(true);
  };
  /** Withdraws the window's action from the plan (nothing executed); one with linked actions is left to its card. */
  function discardStep() {
    const key = questionAction?.key ?? (confirmMembers.length === 1 ? confirmMembers[0].key : undefined);
    if (!state?.action_plan || !key || linkedDiscard(state, key).length) return;
    voice.cancel(); sendAfterVoice.current = false; setCountdown(undefined); handsFree.current = false;
    const target = { plan_ref: state.action_plan.plan_ref, action_key: key };
    void act(() => discardSecretaryAction(state.sessionId, target), 'thinking', true);
  }
  function card(action: PlanAction, group?: ConfirmationGroup) {
    const child = state && viewForAction(state, action), view = child?.state;
    const success = action.status === 'DONE' && (!action.mutation || Boolean(view && receiptOf(view)));
    const failure = ['FAILED_SAFE', 'DOMAIN_CONFLICT', 'UNSUPPORTED', 'BLOCKED_BY_DEPENDENCY'].includes(action.status);
    // Review 2b: a change the backend could not apply holds the action for review; the card says so (no proposal).
    const review = !success && action.assessment.issue === 'REVIEW_REQUIRED';
    const details = review ? humanMessage(action.assessment.preview ?? '') : success || !failure ? actionDetails(view, action, state?.today, released) : humanMessage(action.assessment.preview ?? 'Esta ação não foi concluída. Revise os dados antes de preparar uma nova proposta.');
    const link = success && view ? destinationFor(view, action) : undefined;
    // B6: the same question asked again. From the 2nd time its backend options are pointed out; from the 3rd the
    // agenda's own form is offered (server-computed link with ids/dates only; the form validates and confirms itself).
    const asked = !success ? state?.clarifications?.find(item => item.action_key === action.key) : undefined;
    const fallback = asked?.fallback && /^\/agenda(?:\?|$)/.test(asked.fallback.href) ? asked.fallback : undefined;
    // The question is already in the conversation bubble; the card does not repeat it.
    const lastReply = [...turns].reverse().find(item => item.reply !== undefined)?.reply ?? '';
    const repeated = !success && Boolean(details && details.trim() && lastReply.includes(details.trim()));
    // Only a ready action that really waits for another member of its OWN group says so.
    const waitsForGroup = action.status === 'READY_FOR_CONFIRMATION' && Boolean(group && group.status !== 'READY_FOR_CONFIRMATION' && group.status !== 'DONE' &&
      group.action_keys.some(key => { const other = planAction(key); return key !== action.key && other.status !== 'DONE' && other.status !== 'READY_FOR_CONFIRMATION' && !(!other.mutation && other.status === 'READY'); }));
    // B7: named as the salon registered the subject once resolved ("Fábio Santos"), else with the owner's words.
    const subject = actionSubject(action, state);
    return <article key={action.key} aria-label={actionTitle(action, state)} className="rounded-xl border border-border bg-surface-1 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold">{operationLabels[action.operation] ?? 'Ação'}{subject && <span className="mt-0.5 block font-normal">{subject}</span>}</h3>
        {success ? <CheckCircle2 aria-label="Concluído" className="h-5 w-5 shrink-0 text-emerald-500" /> : failure ? <AlertCircle aria-label="Revisão necessária" className="h-5 w-5 shrink-0 text-amber-500" /> : null}</div>
      <p className="text-[13px] font-medium">{success ? 'Concluído' : action.status === 'DONE' ? 'Aguardando comprovante' : expiredKeys.has(action.key) ? 'Proposta expirada' : review ? 'Precisa ser revista' : waitsForGroup ? 'Pronta — será confirmada junto com as demais' : statusLabels[action.status]}</p>
      {details && !repeated && <ActionSummary text={details} />}
      {!!action.depends_on.length && <p className="text-[13px] text-muted-foreground">Depende de: {action.depends_on.map(key => {
        const dependency = state!.action_plan!.actions.find(item => item.key === key)!;
        return `${operationLabels[dependency.operation] ?? 'ação anterior'} ${actionSubject(dependency, state)}`;
      }).join('; ')}.</p>}
      {view && child && !success && !closed && <>{asked?.options?.length && asked.attempt >= 2 ? <p className="text-[13px] text-muted-foreground">Se preferir, toque em uma das opções abaixo.</p> : null}
        {options(view, child.operation_ref)}
        <Button size="sm" variant="outline" disabled={Boolean(busy || uncertain)} onClick={() => { setOperationRef(child.operation_ref); setDirty(true); input.current?.focus(); }}>Alterar / responder a esta ação</Button></>}
      {action.status !== 'DONE' && !closed && !state?.cancelled && (() => {
        // Withdraws only this action from the current plan; nothing is executed. Actions linked to it (same
        // operation card, or depending on it) would go too: they are named and confirmed first (review 2b).
        const linked = state ? linkedDiscard(state, action.key) : [];
        const discard = (withLinked: boolean) => {
          if (!state?.action_plan) return;
          const target = { plan_ref: state.action_plan.plan_ref, action_key: action.key, ...(withLinked && linked.length ? { linked } : {}) };
          setDiscardAsk(undefined);
          if (child && operationRef === child.operation_ref) setOperationRef(undefined);
          void act(() => discardSecretaryAction(state.sessionId, target), 'thinking', true);
        };
        if (discardAsk === action.key && linked.length) return <div role="group" aria-label="Confirmar descarte" className="space-y-2 rounded-lg border border-border p-2">
          <p className="text-sm">Descartar esta ação também descarta: {linked.map(key => actionTitle(planAction(key), state)).join('; ')}. Nada será executado.</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={Boolean(busy || uncertain)} onClick={() => discard(true)}>Descartar todas</Button>
            <Button size="sm" variant="ghost" disabled={Boolean(busy || uncertain)} onClick={() => setDiscardAsk(undefined)}>Manter</Button></div></div>;
        return <Button size="sm" variant="outline" disabled={Boolean(busy || uncertain)} onClick={() => linked.length ? setDiscardAsk(action.key) : discard(false)}>Descartar esta ação</Button>;
      })()}
      {fallback && !closed && !state?.cancelled && <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4" href={fallback.href} onClick={() => onNavigate?.()}>{fallback.label}</Link>}
      {link && <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4" href={link.href} onClick={() => onNavigate?.()}>{link.label}</Link>}
    </article>;
  }

  /** B7 owner feedback: codes are taken by the server; the owner's comment is optional; the conversation text goes only
   * when the checkbox is ticked. Nothing in the conversation changes. */
  async function submitFeedback(index: number) {
    if (!state || !feedback || feedback.sending) return;
    const current = feedback;
    const transcript = current.transcript ? turns.flatMap(item => [...(item.user?.trim() ? [{ role: 'owner' as const, text: item.user }] : []), ...(item.reply?.trim() ? [{ role: 'secretary' as const, text: item.reply }] : [])])
      .slice(-FEEDBACK_ENTRIES).map(entry => ({ ...entry, text: entry.text.slice(0, FEEDBACK_TEXT) })) : undefined;
    setFeedback({ ...current, sending: true, error: undefined });
    try {
      const reply = await sendSecretaryFeedback({ sessionId: state.sessionId, turn: Math.min(index, 500), ...(current.comment.trim() ? { comment: current.comment.trim().slice(0, 1000) } : {}),
        include_transcript: Boolean(transcript?.length), ...(transcript?.length ? { transcript } : {}) });
      if (reply.ok) { setRated(previous => [...previous, current.turn]); setFeedback(undefined); }
      else setFeedback({ ...current, sending: false, error: reply.error });
    } catch { setFeedback({ ...current, sending: false, error: 'Não foi possível registrar a avaliação agora. A conversa não foi alterada.' }); }
  }
  function feedbackControl(turn: Turn, index: number) {
    if (!feedbackEnabled || !state || (index === 0 && turn.user === undefined)) return null;
    if (rated.includes(turn.id)) return <p className="mt-1 text-[13px] text-muted-foreground">Obrigado. Sua avaliação foi registrada.</p>;
    if (feedback?.turn !== turn.id) return <Button type="button" size="sm" variant="ghost" className="mt-1 min-h-11 px-2 text-[13px]" onClick={() => setFeedback({ turn: turn.id, comment: '', transcript: false })}>Não era isso</Button>;
    return <form aria-label="Avaliar esta resposta" className="mt-2 space-y-2 rounded-lg border border-border p-2" onSubmit={event => { event.preventDefault(); void submitFeedback(index); }}>
      <label htmlFor="secretary-feedback" className="block text-[13px] font-medium">O que você esperava? (opcional)</label>
      <textarea id="secretary-feedback" rows={2} maxLength={1000} value={feedback.comment} disabled={feedback.sending} onChange={event => setFeedback({ ...feedback, comment: event.target.value })}
        className="w-full resize-none rounded-lg border border-border bg-background p-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <label className="flex min-h-11 items-center gap-3 text-[13px]"><input type="checkbox" className="h-5 w-5 shrink-0" checked={feedback.transcript} disabled={feedback.sending} onChange={event => setFeedback({ ...feedback, transcript: event.target.checked })} />incluir o texto desta conversa para melhorar a Secretária</label>
      {feedback.error && <p role="alert" className="text-[13px] text-destructive">{feedback.error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={feedback.sending}>Enviar avaliação</Button>
        <Button type="button" size="sm" variant="ghost" disabled={feedback.sending} onClick={() => setFeedback(undefined)}>Cancelar</Button></div>
    </form>;
  }

  return <section aria-label="Conversa com a Secretária" data-sec-started={turns.length > 0} className="relative flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-1">
      <Button size="sm" variant="outline" disabled={Boolean(busy || uncertain || recording)} onClick={() => void begin()}>Nova conversa</Button>
      {credits && <CreditsMeter view={credits.view} className="ml-auto" />}
      <Button size="sm" variant="ghost" aria-label="Ouvir resposta curta" className="sec-iconbtn" disabled={Boolean(busy || recording || !state)} onClick={() => {
        const text = closed ? 'Confira o resultado de cada ação na tela.' : hasProposal ? 'Confira as ações na tela antes de confirmar.' : humanMessage(state?.message ?? '');
        if (!speakSecretary(text)) setError('Leitura em voz não disponível para esta resposta ou neste dispositivo. A resposta permanece na tela.');
      }}><Volume2 className="mr-1 h-4 w-4" aria-hidden="true" /><span className="sec-label">Ouvir</span></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4" aria-busy={Boolean(busy)}>
      {!turns.length && <div className="py-3"><h2 className="text-lg font-semibold">Como posso ajudar?</h2><p className="mt-2 text-sm text-muted-foreground">Fale ou digite para organizar sua agenda, serviços, clientes e estoque. Você confere tudo antes de confirmar.</p></div>}
      <div role="log" aria-label="Conversa" aria-live="polite" aria-relevant="additions" className="space-y-3">
        {turns.map((turn, index) => {
          const latest = index === turns.length - 1;
          // Past turns are read-only text: the owner's words, the reply and what the actions looked like then.
          return <div key={turn.id} className="space-y-3">
            {turn.user !== undefined && <div className="ml-6 rounded-xl bg-primary/10 p-3"><strong className="text-xs text-muted-foreground">Você</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm">{turn.user}</p></div>}
            {turn.reply !== undefined && <div className="pr-2"><strong className="text-xs text-muted-foreground">Secretária</strong><ActionSummary text={turn.reply} className="mt-1" />
              {latest && feedbackControl(turn, index)}</div>}
            {turn.summary && (!latest || turn.summary.final) && <details className="rounded-lg border border-border px-3 text-sm text-muted-foreground"><summary className="block min-h-11 cursor-pointer py-3">{turn.summary.label}</summary><ul className="mt-2 space-y-1">{turn.summary.items.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}</ul></details>}
          </div>;
        })}
      </div>
      {awaitingReply ? null : state?.action_plan ? <div ref={lastResult} tabIndex={-1} aria-label="Ações e resultados" className="space-y-3 focus:outline-none">
        <p className="text-xs text-muted-foreground">{liveActions.length} {liveActions.length === 1 ? 'ação' : 'ações'} · {state.action_plan.review === 'NORMAL_REVIEW' ? 'Revisão simples' : state.action_plan.review === 'ADVANCED_REVIEW' ? 'Revisão detalhada' : 'Revisão por grupos'}</p>
        {state.action_plan.confirmation_groups.map((group, index) => {
          const several = state.action_plan!.confirmation_groups.length > 1, members = group.action_keys.map(planAction);
          // Per component every group is an independent item: named by its actions, never by position.
          const titles = members.map(action => actionTitle(action, state)).join(' · '), label = confirmationLabel(members, state) || titles;
          return <section key={group.key} aria-label={perComponent ? titles : `Grupo ${index + 1}`} className="space-y-2">
          {several && !perComponent && <h2 className="text-sm font-semibold">Grupo {index + 1}</h2>}
          {members.map(action => card(action, group))}
          {groupOffered(group) && !(decisionOpen && step === 'confirm' && confirmGroup?.key === group.key) && <Button className="w-full min-h-11" variant={readyGroups.length > 1 ? 'outline' : 'default'} disabled={disabled || group.status !== 'READY_FOR_CONFIRMATION'} onClick={() => {
            if (disabled) return;
            const approval = groupApproval(group);
            void act(() => confirmSecretaryGroup(state.sessionId, approval), 'executing');
          }}>Confirmar{several ? perComponent ? ` ${label}` : ` grupo ${index + 1}` : ''}{group.status === 'READY_FOR_CONFIRMATION' ? '' : (() => { const missing = members.filter(action => action.missing_fields.length).length; return missing ? ` (falta ${missing === 1 ? '1 informação' : `${missing} informações`})` : ''; })()}</Button>}
        </section>; })}
        {readyGroups.length > 1 && <Button className="w-full min-h-11" disabled={disabled} onClick={() => {
          if (disabled) return;
          // One call with every current approval; the backend validates them all before executing any.
          const approvals = readyGroups.map(groupApproval);
          void act(() => confirmSecretaryReadyGroups(state.sessionId, approvals), 'executing');
        }}>Confirmar tudo que está pronto ({readyGroups.flatMap(group => group.action_keys).filter(key => planAction(key).status !== 'DONE').length})</Button>}
      </div> : state && (state.skill !== 'auto' || !!state.operations?.length) && <div ref={lastResult} tabIndex={-1} className="space-y-3 focus:outline-none">{(state.operations ?? [{ operation_ref: '', state }]).map(({ operation_ref, state: view }, index) => {
        const proposal = proposalOf(view), receipt = receiptOf(view), done = Boolean(receipt || view.financial?.status === 'DONE' || view.inventory?.status === 'DONE' || view.cancelled);
        const link = receipt ? destinationFor(view) : undefined;
        return <section key={operation_ref} aria-label={`Operação ${index + 1}`} className="rounded-xl border border-border bg-surface-1 p-3 space-y-2">
          <h3 className="text-sm font-semibold">{receipt ? 'Resultado confirmado' : proposal ? 'Confira a proposta' : 'Vamos preparar sua ação'}</h3>
          <ActionSummary text={actionDetails(view)} />
          {!done && !closed && <>{options(view, operation_ref || undefined)}
            {proposal && <div aria-label="Proposta para confirmação"><Button className="w-full min-h-11" disabled={disabled} onClick={() => {
              if (disabled) return;
              const approval = { proposal_ref: proposal.proposal_ref, draft_revision: proposal.draft_revision };
              void act(() => operation_ref ? confirmSecretaryOperation(state.sessionId, operation_ref, approval) : confirmSecretary(state.sessionId, approval), 'executing');
            }}>{legacyConfirmLabel(view)}</Button></div>}
            {!!operation_ref && <Button variant="outline" size="sm" disabled={Boolean(busy || uncertain)} onClick={() => { setOperationRef(operation_ref); setDirty(true); input.current?.focus(); }}>Responder a esta operação</Button>}
          </>}
          {link && <Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href={link.href} onClick={() => onNavigate?.()}>{link.label}</Link>}
        </section>;
      })}</div>}
      {state && [state, ...(state.operations?.map(op => op.state) ?? [])].some(view => view.execution_warnings?.length) && <p className="text-sm">A ação foi registrada, mas houve uma falha técnica posterior. Confira o resultado na tela correspondente.</p>}
      {!!state?.confirmation_batch?.not_executed.length && <p className="text-sm">Algumas ações não foram executadas porque mudaram ou expiraram antes da confirmação. Revise-as acima antes de confirmar de novo.</p>}
      <div ref={threadEnd} aria-hidden="true" />
    </div>
    {decisionOpen && step && state && <div className="absolute inset-0 z-20 flex items-end justify-center bg-background/70 px-3 pt-3 backdrop-blur-[2px] sm:items-center" style={{ paddingBottom: 'max(.75rem, var(--sec-bottom-inset, var(--safe-bottom, 0px)))' }}
      onClick={event => { if (event.target === event.currentTarget && !countdown) setDecisionOpen(false); }}>
      <div ref={decisionWindow} role="dialog" aria-modal="false" aria-labelledby="secretary-decision-title" className="sec-sheet flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        onKeyDown={event => { if (event.key === 'Escape' && !countdown) { event.stopPropagation(); setDecisionOpen(false); } }}>
        {/* Owner 06/10 (mobile): only this part scrolls (short screen, virtual keyboard, landscape); the footer below it never does,
            so Confirmar and the way out are always in reach. */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
        <div className="flex items-start justify-between gap-2">
          <div><p className="text-[13px] font-medium text-muted-foreground">{step === 'choice' ? decisions.length > 1 ? `Decisão 1 de ${decisions.length}` : 'Decisão pendente' : step === 'question' ? 'Falta uma informação' : 'Confira e confirme'}</p>
            <h2 id="secretary-decision-title" className="text-base font-semibold">{step === 'choice' ? decision!.action ? actionTitle(decision!.action, state) : 'Escolha uma opção'
              : step === 'question' ? actionTitle(questionAction!, state) : confirmMembers.map(action => actionTitle(action, state)).join(' · ')}</h2></div>
          <Button type="button" size="icon" variant="ghost" className="-mr-2 -mt-2 shrink-0" aria-label="Fechar janela de decisão" disabled={Boolean(countdown)} onClick={() => setDecisionOpen(false)}><X className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        {step === 'choice' && <>
          {(() => { const question = decision!.action ? actionDetails(decision!.view, decision!.action, state.today, released) : actionDetails(decision!.view);
            return question ? <p className="whitespace-pre-wrap break-words text-sm">{question}</p> : null; })()}
          {choiceButtons(decision!.view, decision!.operation)}
        </>}
        {step === 'question' && (() => {
          // The Secretary's own question (the newest reply) first; the card's hint below it when it says something else.
          const asked = [...turns].reverse().find(item => item.reply !== undefined)?.reply ?? '', hint = actionDetails(questionChild!.state, questionAction!, state.today, released);
          return <><p className="whitespace-pre-wrap break-words text-base font-medium">{asked || hint}</p>
            {hint && asked && !asked.includes(hint.trim()) && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{hint}</p>}</>;
        })()}
        {step === 'confirm' && <>
          {confirmMembers.map(action => { const child = viewForAction(state, action);
            return <ActionSummary key={action.key} text={actionDetails(child?.state, action, state.today, released)} className="rounded-lg bg-surface-1 p-3" />; })}
          {voiceEnabled && !countdown && <p className="text-[13px] text-muted-foreground">{oneToConfirm ? 'Ou diga “confirma”. Para mudar algo, é só falar o que muda.' : 'Para mudar algo, é só falar o que muda.'}</p>}
        </>}
        {flowNote && !countdown && <p role="status" className="text-sm">{flowNote}</p>}
        {step !== 'choice' && !countdown && voiceEnabled && (recording || voice.phase === 'processing') && <div className="flex flex-wrap items-center gap-2">
          {recording ? <><span role="status" className="text-sm font-medium text-primary">{voice.phase === 'requesting' ? 'Permita o microfone…' : `Ouvindo…${elapsed}`}{message ? ` “${message}”` : ''}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => { sendAfterVoice.current = true; if (voice.phase === 'listening') voice.stop(); }}>Pronto</Button></>
            : <span role="status" className="text-sm text-muted-foreground">Transcrevendo…{seconds}</span>}
        </div>}
        {step !== 'choice' && !countdown && voiceEnabled && transcribeEnabled && recorder.silenced && !recording && <p className="text-[13px] text-muted-foreground">O microfone fechou porque ninguém falou.</p>}
        {step !== 'choice' && !countdown && <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); const text = windowText; void sendText(text).then(sent => { if (sent) setWindowText(''); }); }}>
          <label htmlFor="secretary-window-answer" className="sr-only">Responder digitando</label>
          <input id="secretary-window-answer" value={windowText} maxLength={1000} disabled={Boolean(busy || uncertain || recording)} onChange={event => setWindowText(event.target.value)}
            placeholder={step === 'question' ? 'Ou digite: dia 12 às 10h' : 'Ou digite o que muda'} className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {voiceEnabled && !recording && voice.phase !== 'processing' && <Button type="button" size="sm" className="sec-iconbtn" disabled={Boolean(busy || uncertain)} onClick={() => { handsFree.current = true; listen(); }}><Mic className="mr-2 h-4 w-4" aria-hidden="true" /><span className="sec-label">{transcribeEnabled && recorder.silenced ? 'Falar de novo' : 'Falar'}</span></Button>}
          <Button type="submit" variant="outline" className="min-h-11" disabled={Boolean(busy || uncertain || recording || !windowText.trim())} aria-label="Enviar resposta"><Send className="h-4 w-4" aria-hidden="true" /></Button>
        </form>}
        </div>
        <div className="sec-foot flex shrink-0 flex-col gap-2 border-t border-border bg-card p-3">
          {step === 'confirm' && (countdown ? <div role="status" className="space-y-2 rounded-lg border border-primary/50 p-3">
            <p className="text-sm font-medium">{flowNote ? `${flowNote} ` : ''}Confirmando em {Math.max(1, Math.ceil((countdown.until - Date.now()) / 1000))} s…</p>
            <Button type="button" variant="outline" className="w-full min-h-11" onClick={() => { setCountdown(undefined); setFlowNote('Confirmação cancelada. Nada foi gravado.'); }}>Cancelar</Button>
          </div> : <Button type="button" className="w-full min-h-11" disabled={Boolean(busy || uncertain)} onClick={confirmNow}>Confirmar</Button>)}
          {!countdown && <div className="flex flex-wrap gap-2">
            {step === 'choice' && <Button type="button" size="sm" variant="outline" disabled={Boolean(busy || uncertain)} onClick={answerByMessage}>Responder por mensagem</Button>}
            {step !== 'choice' && (() => { const key = questionAction?.key ?? (oneToConfirm ? confirmMembers[0].key : undefined);
              return key && !linkedDiscard(state, key).length ? <Button type="button" size="sm" variant="outline" disabled={Boolean(busy || uncertain)} onClick={discardStep}>Descartar pedido</Button> : null; })()}
            <Button type="button" size="sm" variant="ghost" onClick={() => { voice.cancel(); sendAfterVoice.current = false; setDecisionOpen(false); }}>Decidir depois</Button>
          </div>}
          {busy && <p role="status" className="text-[13px] text-muted-foreground">{busy === 'executing' ? 'Executando…' : 'Preparando…'}{seconds}</p>}
        </div>
      </div>
    </div>}
    <div className="shrink-0 border-t border-border bg-card p-3 space-y-2" style={{ paddingBottom: 'max(.75rem, var(--sec-bottom-inset, var(--safe-bottom, 0px)))' }}>
      {!decisionOpen && step && <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
        <span className="font-medium">{step === 'choice' ? decisions.length === 1 ? '1 decisão pendente' : `${decisions.length} decisões pendentes` : step === 'question' ? 'Falta uma informação' : 'Pronto para confirmar'}</span>
        <Button type="button" size="sm" disabled={Boolean(busy || uncertain)} onClick={() => setDecisionOpen(true)}>Responder</Button>
      </div>}
      {/* Owner 06/10 (mobile): the status and "Cancelar conversa" share one row (no 44 px row of their own), and the idle text of an empty box is left to screen readers. */}
      <div className="flex items-center justify-between gap-2">
        <p role="status" aria-live="polite" className={`min-w-0 flex-1 text-sm font-medium${status === idleStatus ? ' sec-status-idle' : ''}`}>{status}{slow ? ' Ainda aguardando o sistema; nenhuma nova tentativa foi iniciada.' : ''}</p>
        {state && !closed && <Button size="sm" variant="ghost" className="shrink-0" disabled={Boolean(busy || uncertain || recording)} onClick={() => void act(() => cancelSecretary(state.sessionId), 'thinking', true)}>Cancelar conversa</Button>}
      </div>
      {credits && <CreditsNotice view={credits.view} canRecharge={credits.canRecharge} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {uncertain && <Button variant="outline" disabled={Boolean(busy)} onClick={() => { if (retry.current) void act(retry.current, 'executing'); }}>Verificar resultado</Button>}
      {!closed && <form onSubmit={event => { event.preventDefault(); if (recording) finishAndSend(); else void send(); }} className="space-y-2">
        {operationRef && <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground"><span>Respondendo à ação selecionada.</span><button type="button" className="min-h-11 px-2 font-medium underline underline-offset-4" disabled={Boolean(busy || uncertain)} onClick={() => setOperationRef(undefined)}>Sair da seleção</button></div>}
        {!!state?.suspended_plans?.length && <div className="space-y-1" aria-label="Pedidos preservados"><p className="text-[13px] text-muted-foreground">Pedidos pausados — retome se ainda quiser</p>{state.suspended_plans.map(saved => <Button key={saved.plan_ref} size="sm" variant="outline" disabled={Boolean(busy || uncertain || state.cancelled)} onClick={() => { setOperationRef(undefined); void act(() => resumeSecretaryPlan(state.sessionId, saved.plan_ref), 'thinking', true); }}>Retomar {saved.label.split(', ').map(op => operationLabels[op] ?? op).join(', ')}{saved.subjects?.length ? ` — ${saved.subjects.join(', ')}` : ''}</Button>)}</div>}
        <label htmlFor="secretary-message" className="sec-label text-xs font-medium">{voice.phase === 'ready' ? 'Transcrição — revise ou edite' : 'Mensagem'}</label>
        <div className="sec-row">
          <textarea ref={input} id="secretary-message" aria-label="Mensagem" rows={1} maxLength={1000} disabled={Boolean(busy || uncertain)} readOnly={recording} value={message} onChange={event => edit(event.target.value)} onKeyDown={event => {
            // Enter sends; Shift+Enter breaks the line (never while an input method is composing).
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
          }} placeholder={compact ? 'Ex.: Massagem para R$90' : 'Ex.: altera a Massagem para R$90'} className="sec-input resize-none rounded-lg border border-border bg-background p-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
          <div className="sec-buttons">
              {voiceEnabled && <Button type="button" data-secretary-mic="" className="sec-iconbtn" variant={recording ? 'outline' : 'default'} aria-label={recording ? 'Parar gravação' : 'Falar com a Secretária'} disabled={Boolean(busy || uncertain)} onClick={() => {
                // "Parar" leaves the transcript in the box for review; while the permission is still asked, it gives up.
                if (recording) { if (voice.phase === 'requesting') cancelRecording(); else { sendAfterVoice.current = false; voice.stop(); } return; }
                startVoice();
              }}>{recording ? <Square className="mr-2 h-4 w-4" aria-hidden="true" /> : <Mic className="mr-2 h-4 w-4" aria-hidden="true" />}<span className={recording ? undefined : 'sec-label'}>{recording ? 'Parar' : 'Falar'}</span></Button>}
              <Button type="submit" className="sec-iconbtn sec-send min-h-11" disabled={Boolean(busy || uncertain || voice.phase === "requesting" || (!recording && !message.trim()))}><Send className="mr-2 h-4 w-4" aria-hidden="true" /><span className="sec-label">Enviar</span></Button>
          </div>
        </div>
        {voiceCorrection && corrections && corrections.text === message && !recording && <div aria-label="Correções sugeridas" className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Você quis dizer:</span>
          {corrections.items.map(item => <Button key={`${item.start}:${item.to}`} type="button" size="sm" variant="outline" disabled={Boolean(busy || uncertain)} aria-label={`Trocar “${item.from}” por “${item.to}”`} onClick={() => acceptCorrection(item)}>{item.to}?</Button>)}
          <Button type="button" size="sm" variant="ghost" onClick={() => setCorrections(undefined)}>Manter como está</Button>
        </div>}
        {(recording || (voice.phase === 'ready' && message === dictated.current)) && <div className="flex flex-wrap items-center gap-2">
            {recording && <Button type="button" variant="ghost" onClick={cancelRecording}>Cancelar gravação</Button>}
            {/* Only while the box still holds exactly what the latest dictation produced: an edit is never undone. */}
            {!recording && voice.phase === 'ready' && message === dictated.current && <Button type="button" variant="ghost" disabled={Boolean(busy || uncertain)} onClick={() => {
              voice.cancel(); setCorrections(undefined); edit(beforeVoice.current);
            }}>Desfazer ditado</Button>}
        </div>}
        {voiceEnabled && <p className={`text-xs text-muted-foreground${voice.supported ? ' sec-voice-note' : ''}`}>{transcribeEnabled
          ? voice.supported ? 'A gravação é transcrita pelo serviço da Secretária. Revise o texto antes de enviar.' : 'Gravação indisponível neste navegador. Use o campo de mensagem.'
          : voice.supported ? 'A transcrição usa o serviço de voz do navegador. Revise o texto antes de enviar.' : 'Voz indisponível neste navegador. Use o campo de mensagem.'}</p>}
        <p className="sec-shortcuts hidden text-xs text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:block">{voiceEnabled
          ? 'Atalhos: Enter envia (também o que você falou) · Esc cancela a fala · Ctrl+Espaço começa a falar · Shift+Enter quebra a linha.'
          : 'Atalhos: Enter envia · Shift+Enter quebra a linha.'}</p>
      </form>}
    </div>
  </section>;
}
