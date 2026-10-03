"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mic, Square, Send, Volume2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SecretaryView } from '@/lib/salon-secretary';
import type { ConfirmationGroup, PlanAction } from '@everflair/salon-secretary';
import { acceptDictationSuggestion, actionDetails, actionSubject, actionTitle, candidatesOf, confirmationLabel, destinationFor, hasReceipt, humanMessage, legacyConfirmLabel,
  operationLabels, planReleasedAppointments, planSummary, proposalOf, rawProposalOf, proposalExpired, receiptOf, reviewOf, reviewHeading, statusLabels, viewForAction, linkedDiscard } from '@/lib/secretary-ui';
import type { DictationSuggestion } from '@/lib/secretary-voice-correction';
import { startSecretary, sendSecretary, selectSecretaryCustomer, selectSecretaryService, confirmSecretary,
  cancelSecretary, resumeSecretaryPlan, selectSecretaryOperation, confirmSecretaryOperation, confirmSecretaryGroup, confirmSecretaryReadyGroups,
  discardSecretaryAction, selectSecretaryOption, suggestSecretaryDictation, transcribeSecretaryVoice, sendSecretaryFeedback, currentSecretary, type SecretaryReply, type CurrentSecretaryReply } from './actions';
import { joinDictation, speakSecretary, useSecretaryRecorder, useSecretaryVoice } from './use-secretary-voice';
import { formatLocal } from '@/lib/secretary-datetime-format';

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
 * `feedbackEnabled` (SALON_SECRETARY_FEEDBACK, default off): "Não era isso" on the latest reply. */
export function SecretaryChat({ voiceEnabled = false, active = true, voiceCorrection = false, transcribeEnabled = false, feedbackEnabled = false, onNavigate }: { voiceEnabled?: boolean; active?: boolean; voiceCorrection?: boolean; transcribeEnabled?: boolean; feedbackEnabled?: boolean; onNavigate?: () => void }) {
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
  /** Review 2b: the card whose discard would also take linked actions, waiting for the owner's confirmation. */
  const [discardAsk, setDiscardAsk] = useState<string>();
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
  const recording = voice.phase === 'listening' || voice.phase === 'processing';
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
    if (!voiceCorrection || voice.phase !== 'ready' || !typed.current.trim()) return;
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
  async function send() {
    if (!message.trim() || busy || recording || uncertain) return;
    const text = message, turn = ++turnIds.current;
    setTurns(previous => [...previous, { id: turn, user: text }]); setFeedback(undefined);
    const result = await act(async () => {
      const current = state ?? (await startSecretary());
      if ('ok' in current && !current.ok) return current;
      const session = 'ok' in current ? current.state : current;
      if (!state) setState(session);
      return sendSecretary({ sessionId: session.sessionId, message: text, ...(operationRef ? { operation_ref: operationRef } : {}) });
    }, 'thinking', true, turn);
    if (result) setMessage('');
  }
  function edit(text: string) { setMessage(text); if (hasProposal) setDirty(true); }
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
  const status = busy === 'executing' ? 'Executando…' : busy ? 'Entendendo e preparando…' : voice.phase === 'listening' ? `Ouvindo…${elapsed}` : voice.phase === 'processing' ? 'Transcrevendo…' : voice.phase === 'ready' && message ? limited ? 'A gravação chegou ao limite e foi encerrada. Revise antes de enviar.' : 'Transcrição pronta. Revise antes de enviar.' : uncertain ? 'Resultado ainda não verificado' : state?.cancelled ? 'Conversa encerrada' : state?.action_plan?.status === 'PARTIAL_FAILURE' ? 'Revise o resultado de cada ação' : closed ? 'Resultado confirmado pelo sistema' : expiryVisible ? 'Proposta expirada. Envie uma mensagem para preparar novamente.' : dirty && hasProposal ? 'Proposta anterior desatualizada' : hasProposal ? 'Confira antes de confirmar' : 'Fale ou escreva o que precisa';

  // B4: a backend-offered time slot is applied as a short answer and prepared again; it never confirms.
  function pickSlot(option: string, operation: string) {
    if (!state) return;
    void act(() => selectSecretaryOption(state.sessionId, operation, option, state.action_plan?.revision), 'thinking', true);
  }
  function options(view: SecretaryView, operation?: string) {
    // Numbered like the question lists them, so "a segunda" / "opção 2" read naturally.
    const slots = operation ? view.options ?? [] : [];
    // D1: a learned alias proposes one entity, already highlighted; it is still only chosen by this click.
    const proposed = view.scheduling?.candidates?.source === 'alias';
    return <>
      {!!candidatesOf(view).length && <div aria-label="Opções encontradas" className="flex flex-col gap-2">
        {candidatesOf(view).map((candidate, index) => <Button key={candidate.id} variant={proposed && index === 0 ? 'default' : 'outline'} disabled={Boolean(busy || uncertain)} className="h-auto min-h-11 justify-start whitespace-normal text-left" onClick={() => select(view, candidate.id, operation)}>{`${index + 1}. ${candidate.label}`}</Button>)}
      </div>}
      {!!slots.length && <div aria-label="Horários disponíveis" className="flex flex-col gap-2">
        {slots.map((slot, index) => <Button key={slot.option_id} variant="outline" disabled={Boolean(busy || uncertain)} className="h-auto min-h-11 justify-start whitespace-normal text-left" onClick={() => pickSlot(slot.option_id, operation!)}>{`${index + 1}. ${slot.label}`}</Button>)}
      </div>}
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
      <p className="text-xs font-medium">{success ? 'Concluído' : action.status === 'DONE' ? 'Aguardando comprovante' : expiredKeys.has(action.key) ? 'Proposta expirada' : review ? 'Precisa ser revista' : waitsForGroup ? 'Pronta — será confirmada junto com as demais' : statusLabels[action.status]}</p>
      {details && !repeated && <p className="whitespace-pre-wrap break-words text-sm">{details}</p>}
      {!!action.depends_on.length && <p className="text-xs text-muted-foreground">Depende de: {action.depends_on.map(key => {
        const dependency = state!.action_plan!.actions.find(item => item.key === key)!;
        return `${operationLabels[dependency.operation] ?? 'ação anterior'} ${actionSubject(dependency, state)}`;
      }).join('; ')}.</p>}
      {view && child && !success && !closed && <>{asked?.options?.length && asked.attempt >= 2 ? <p className="text-xs text-muted-foreground">Se preferir, toque em uma das opções abaixo.</p> : null}
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
    if (rated.includes(turn.id)) return <p className="mt-1 text-xs text-muted-foreground">Obrigado. Sua avaliação foi registrada.</p>;
    if (feedback?.turn !== turn.id) return <Button type="button" size="sm" variant="ghost" className="mt-1 min-h-8 px-2 text-xs" onClick={() => setFeedback({ turn: turn.id, comment: '', transcript: false })}>Não era isso</Button>;
    return <form aria-label="Avaliar esta resposta" className="mt-2 space-y-2 rounded-lg border border-border p-2" onSubmit={event => { event.preventDefault(); void submitFeedback(index); }}>
      <label htmlFor="secretary-feedback" className="block text-xs font-medium">O que você esperava? (opcional)</label>
      <textarea id="secretary-feedback" rows={2} maxLength={1000} value={feedback.comment} disabled={feedback.sending} onChange={event => setFeedback({ ...feedback, comment: event.target.value })}
        className="w-full resize-none rounded-lg border border-border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={feedback.transcript} disabled={feedback.sending} onChange={event => setFeedback({ ...feedback, transcript: event.target.checked })} />incluir o texto desta conversa para melhorar a Secretária</label>
      {feedback.error && <p role="alert" className="text-xs text-destructive">{feedback.error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={feedback.sending}>Enviar avaliação</Button>
        <Button type="button" size="sm" variant="ghost" disabled={feedback.sending} onClick={() => setFeedback(undefined)}>Cancelar</Button></div>
    </form>;
  }

  return <section aria-label="Conversa com a Secretária" className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
      <Button size="sm" variant="outline" disabled={Boolean(busy || uncertain || recording)} onClick={() => void begin()}>Nova conversa</Button>
      <Button size="sm" variant="ghost" aria-label="Ouvir resposta curta" disabled={Boolean(busy || recording || !state)} onClick={() => {
        const text = closed ? 'Confira o resultado de cada ação na tela.' : hasProposal ? 'Confira as ações na tela antes de confirmar.' : humanMessage(state?.message ?? '');
        if (!speakSecretary(text)) setError('Leitura em voz não disponível para esta resposta ou neste dispositivo. A resposta permanece na tela.');
      }}><Volume2 className="mr-1 h-4 w-4" aria-hidden="true" />Ouvir</Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4" aria-busy={Boolean(busy)}>
      {!turns.length && <div className="py-3"><h2 className="text-lg font-semibold">Como posso ajudar?</h2><p className="mt-2 text-sm text-muted-foreground">Fale ou digite para organizar sua agenda, serviços, clientes e estoque. Você confere tudo antes de confirmar.</p></div>}
      <div role="log" aria-label="Conversa" aria-live="polite" aria-relevant="additions" className="space-y-3">
        {turns.map((turn, index) => {
          const latest = index === turns.length - 1;
          // Past turns are read-only text: the owner's words, the reply and what the actions looked like then.
          return <div key={turn.id} className="space-y-3">
            {turn.user !== undefined && <div className="ml-6 rounded-xl bg-primary/10 p-3"><strong className="text-xs text-muted-foreground">Você</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm">{turn.user}</p></div>}
            {turn.reply !== undefined && <div className="pr-2"><strong className="text-xs text-muted-foreground">Secretária</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm">{turn.reply}</p>
              {latest && feedbackControl(turn, index)}</div>}
            {turn.summary && (!latest || turn.summary.final) && <details className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground"><summary className="cursor-pointer">{turn.summary.label}</summary><ul className="mt-2 space-y-1">{turn.summary.items.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}</ul></details>}
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
          {groupOffered(group) && <Button className="w-full min-h-11" variant={readyGroups.length > 1 ? 'outline' : 'default'} disabled={disabled || group.status !== 'READY_FOR_CONFIRMATION'} onClick={() => {
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
          <p className="whitespace-pre-wrap break-words text-sm">{actionDetails(view)}</p>
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
    <div className="shrink-0 border-t border-border bg-card p-3 space-y-2" style={{ paddingBottom: 'max(.75rem, var(--safe-bottom, 0px))' }}>
      <p role="status" aria-live="polite" className="text-xs font-medium">{status}{slow ? ' Ainda aguardando o sistema; nenhuma nova tentativa foi iniciada.' : ''}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {uncertain && <Button variant="outline" disabled={Boolean(busy)} onClick={() => { if (retry.current) void act(retry.current, 'executing'); }}>Verificar resultado</Button>}
      {!closed && <form onSubmit={event => { event.preventDefault(); void send(); }} className="space-y-2">
        {operationRef && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>Respondendo à ação selecionada.</span><button type="button" disabled={Boolean(busy || uncertain)} onClick={() => setOperationRef(undefined)}>Sair da seleção</button></div>}
        {!!state?.suspended_plans?.length && <div className="space-y-1" aria-label="Pedidos preservados"><p className="text-xs text-muted-foreground">Pedidos anteriores preservados</p>{state.suspended_plans.map(saved => <Button key={saved.plan_ref} size="sm" variant="outline" disabled={Boolean(busy || uncertain || state.cancelled)} onClick={() => { setOperationRef(undefined); void act(() => resumeSecretaryPlan(state.sessionId, saved.plan_ref), 'thinking', true); }}>Retomar {saved.label.split(', ').map(op => operationLabels[op] ?? op).join(', ')}</Button>)}</div>}
        <label htmlFor="secretary-message" className="text-xs font-medium">{voice.phase === 'ready' ? 'Transcrição — revise ou edite' : 'Mensagem'}</label>
        <textarea ref={input} id="secretary-message" aria-label="Mensagem" rows={2} maxLength={1000} disabled={Boolean(busy || uncertain || recording)} value={message} onChange={event => edit(event.target.value)} placeholder="Ex.: altera a Massagem para R$90" className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
        {voiceCorrection && corrections && corrections.text === message && !recording && <div aria-label="Correções sugeridas" className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Você quis dizer:</span>
          {corrections.items.map(item => <Button key={`${item.start}:${item.to}`} type="button" size="sm" variant="outline" disabled={Boolean(busy || uncertain)} aria-label={`Trocar “${item.from}” por “${item.to}”`} onClick={() => acceptCorrection(item)}>{item.to}?</Button>)}
          <Button type="button" size="sm" variant="ghost" onClick={() => setCorrections(undefined)}>Manter como está</Button>
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          {voiceEnabled && <Button type="button" data-secretary-mic="" variant={recording ? 'outline' : 'default'} aria-label={recording ? 'Parar gravação' : 'Falar com a Secretária'} disabled={Boolean(busy || uncertain)} onClick={() => {
            if (recording) { voice.stop(); return; }
            beforeVoice.current = message; setDirty(true); setError(''); setCorrections(undefined); voice.start();
          }}>{recording ? <Square className="mr-2 h-4 w-4" aria-hidden="true" /> : <Mic className="mr-2 h-4 w-4" aria-hidden="true" />}{recording ? 'Parar' : 'Falar'}</Button>}
          {recording && <Button type="button" variant="ghost" onClick={() => { voice.cancel(); setMessage(beforeVoice.current); }}>Cancelar gravação</Button>}
          {/* Only while the box still holds exactly what the latest dictation produced: an edit is never undone. */}
          {!recording && voice.phase === 'ready' && message === dictated.current && <Button type="button" variant="ghost" disabled={Boolean(busy || uncertain)} onClick={() => {
            voice.cancel(); setCorrections(undefined); edit(beforeVoice.current);
          }}>Desfazer ditado</Button>}
          <Button type="submit" className="ml-auto min-h-11" disabled={Boolean(busy || recording || uncertain || !message.trim())}><Send className="mr-2 h-4 w-4" aria-hidden="true" />Enviar</Button>
        </div>
        {voiceEnabled && <p className="text-[11px] text-muted-foreground">{transcribeEnabled
          ? voice.supported ? 'A gravação é transcrita pelo serviço da Secretária. Revise o texto antes de enviar.' : 'Gravação indisponível neste navegador. Use o campo de mensagem.'
          : voice.supported ? 'A transcrição usa o serviço de voz do navegador. Revise o texto antes de enviar.' : 'Voz indisponível neste navegador. Use o campo de mensagem.'}</p>}
      </form>}
      {state && !closed && <Button size="sm" variant="ghost" disabled={Boolean(busy || uncertain || recording)} onClick={() => void act(() => cancelSecretary(state.sessionId), 'thinking', true)}>Cancelar conversa</Button>}
    </div>
  </section>;
}
