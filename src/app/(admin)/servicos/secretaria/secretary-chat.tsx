"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mic, Square, Send, Volume2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SecretaryView } from '@/lib/salon-secretary';
import type { PlanAction } from '@everflair/salon-secretary';
import { actionDetails, actionEntity, candidatesOf, destinationFor, hasReceipt, humanMessage, legacyConfirmLabel,
  operationLabels, proposalOf, rawProposalOf, proposalExpired, receiptOf, reviewOf, statusLabels, viewForAction } from '@/lib/secretary-ui';
import { startSecretary, sendSecretary, selectSecretaryCustomer, selectSecretaryService, confirmSecretary,
  cancelSecretary, resumeSecretaryPlan, selectSecretaryOperation, confirmSecretaryOperation, confirmSecretaryGroup, type SecretaryReply } from './actions';
import { speakSecretary, useSecretaryVoice } from './use-secretary-voice';

export function SecretaryChat({ voiceEnabled = false, active = true }: { voiceEnabled?: boolean; active?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<SecretaryView>();
  const [viewTime,setViewTime]=useState(()=>Date.now());
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [message, setMessage] = useState('');
  const [operationRef, setOperationRef] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'thinking' | 'executing' | null>(null);
  const [slow, setSlow] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const retry = useRef<() => Promise<SecretaryReply>>();
  const input = useRef<HTMLTextAreaElement>(null);
  const lastResult = useRef<HTMLDivElement>(null);
  const beforeVoice = useRef('');
  const voice = useSecretaryVoice(setMessage, setError);
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
  useEffect(() => { if (!active) { cancelVoice(); window.speechSynthesis?.cancel(); } }, [active, cancelVoice]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  async function act(fn: () => Promise<SecretaryReply>, kind: 'thinking' | 'executing' = 'thinking', withdraw = false) {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setSlow(false); setError('');
    if (withdraw) setDirty(true);
    if (kind === 'executing') retry.current = fn;
    const timer = setTimeout(() => setSlow(true), 20000);
    try {
      const reply = await fn();
      if (reply.ok) {
        setState(reply.state);setViewTime(Date.now());
        if (state?.action_plan?.plan_ref !== reply.state.action_plan?.plan_ref) setOperationRef(undefined);
        setDirty(false); setUncertain(false); retry.current = undefined;
        const text = reply.state.capability_status ? humanMessage(reply.state.message) : reply.state.action_plan?.status === 'DONE' ? 'Confira os resultados abaixo.'
          : reply.state.action_plan?.status === 'READY_FOR_CONFIRMATION' ? 'Preparei as ações. Confira os detalhes antes de confirmar.' : humanMessage(reply.state.message);
        setMessages(previous => [...previous, { role: 'Secretária', text }]);
        if (kind === 'executing' && hasReceipt(reply.state)) router.refresh();
        if (kind === 'executing') requestAnimationFrame(() => lastResult.current?.focus());
        return reply.state;
      }
      setError(reply.error);
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
    if (next) { setMessages([{ role: 'Secretária', text: humanMessage(next.message) }]); input.current?.focus(); }
  }
  async function send() {
    if (!message.trim() || busy || recording || uncertain) return;
    const text = message;
    setMessages(previous => [...previous, { role: 'Você', text }]);
    const result = await act(async () => {
      const current = state ?? (await startSecretary());
      if ('ok' in current && !current.ok) return current;
      const session = 'ok' in current ? current.state : current;
      if (!state) setState(session);
      return sendSecretary({ sessionId: session.sessionId, message: text, ...(operationRef ? { operation_ref: operationRef } : {}) });
    }, 'thinking', true);
    if (result) setMessage('');
  }
  function edit(text: string) { setMessage(text); if (hasProposal) setDirty(true); }
  function select(view: SecretaryView, ref: string, operation?: string) {
    if (!state) return;
    void act(() => operation ? selectSecretaryOperation(state.sessionId, operation, ref) : view.customer ? selectSecretaryCustomer(state.sessionId, ref) : selectSecretaryService(state.sessionId, ref), 'thinking', true);
  }
  const disabled = Boolean(busy || dirty || uncertain || recording || state?.cancelled || confirmationSuppressed);
  const status = busy === 'executing' ? 'Executando…' : busy ? 'Entendendo e preparando…' : voice.phase === 'listening' ? 'Ouvindo…' : voice.phase === 'processing' ? 'Transcrevendo…' : voice.phase === 'ready' && message ? 'Transcrição pronta. Revise antes de enviar.' : uncertain ? 'Resultado ainda não verificado' : state?.cancelled ? 'Conversa encerrada' : state?.action_plan?.status === 'PARTIAL_FAILURE' ? 'Revise o resultado de cada ação' : closed ? 'Resultado confirmado pelo sistema' : expiryVisible ? 'Proposta expirada. Envie uma mensagem para preparar novamente.' : dirty && hasProposal ? 'Proposta anterior desatualizada' : hasProposal ? 'Confira antes de confirmar' : 'Fale ou escreva o que precisa';

  function options(view: SecretaryView, operation?: string) {
    return <>
      {!!candidatesOf(view).length && <div aria-label="Opções encontradas" className="flex flex-col gap-2">
        {candidatesOf(view).map(candidate => <Button key={candidate.id} variant="outline" disabled={Boolean(busy || uncertain)} className="h-auto min-h-11 justify-start whitespace-normal text-left" onClick={() => select(view, candidate.id, operation)}>{candidate.label}</Button>)}
      </div>}
      {reviewOf(view) && <div className="border-l-2 border-amber-500 pl-3 text-sm">
        <strong>{reviewOf(view)!.status === 'CONFLICT_HARD_BLOCK' ? 'Este horário não pode ser usado' : 'Atenção ao horário'}</strong>
        <p>{humanMessage(reviewOf(view)!.message)}</p>
        {reviewOf(view)!.alternatives.length > 0 && <p>Alternativas disponíveis: {reviewOf(view)!.alternatives.map(slot => slot.startLocal.replace('T', ' às ')).join(', ')}.</p>}
      </div>}
    </>;
  }
  function confirmationBlocked(action: PlanAction) {
    const failures = ['FAILED_SAFE','UNSUPPORTED','DOMAIN_CONFLICT','BLOCKED_BY_DEPENDENCY'];
    // Missing fields can project a conflicting assessment as NEEDS_INPUT.
    // Preserve the underlying backend veto when deciding whether to offer confirmation.
    return failures.includes(action.status) || failures.includes(action.assessment.status) || action.assessment.issue === 'PROPOSAL_EXPIRED';
  }
  function card(action: PlanAction) {
    const child = state && viewForAction(state, action), view = child?.state;
    const success = action.status === 'DONE' && (!action.mutation || Boolean(view && receiptOf(view)));
    const failure = ['FAILED_SAFE', 'DOMAIN_CONFLICT', 'UNSUPPORTED', 'BLOCKED_BY_DEPENDENCY'].includes(action.status);
    const details = success || !failure ? actionDetails(view, action) : humanMessage(action.assessment.preview ?? 'Esta ação não foi concluída. Revise os dados antes de preparar uma nova proposta.');
    const link = success && view ? destinationFor(view, action) : undefined;
    return <article key={action.key} aria-label={`${operationLabels[action.operation] ?? 'Ação'}${actionEntity(action) ? ` — ${actionEntity(action)}` : ''}`} className="rounded-xl border border-border bg-surface-1 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold">{operationLabels[action.operation] ?? 'Ação'}{actionEntity(action) && <span className="mt-0.5 block font-normal">{actionEntity(action)}</span>}</h3>
        {success ? <CheckCircle2 aria-label="Concluído" className="h-5 w-5 shrink-0 text-emerald-500" /> : failure ? <AlertCircle aria-label="Revisão necessária" className="h-5 w-5 shrink-0 text-amber-500" /> : null}</div>
      <p className="text-xs font-medium">{success ? 'Concluído' : action.status === 'DONE' ? 'Aguardando comprovante' : expiredKeys.has(action.key) ? 'Proposta expirada' : statusLabels[action.status]}</p>
      {details && <p className="whitespace-pre-wrap break-words text-sm">{details}</p>}
      {!!action.depends_on.length && <p className="text-xs text-muted-foreground">Depende de: {action.depends_on.map(key => {
        const dependency = state!.action_plan!.actions.find(item => item.key === key)!;
        return `${operationLabels[dependency.operation] ?? 'ação anterior'} ${actionEntity(dependency)}`;
      }).join('; ')}.</p>}
      {view && child && !success && !closed && <>{options(view, child.operation_ref)}
        <Button size="sm" variant="outline" disabled={Boolean(busy || uncertain)} onClick={() => { setOperationRef(child.operation_ref); setDirty(true); input.current?.focus(); }}>Alterar / responder a esta ação</Button></>}
      {link && <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4" href={link.href}>{link.label}</Link>}
    </article>;
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
      {!messages.length && <div className="py-3"><h2 className="text-lg font-semibold">Como posso ajudar?</h2><p className="mt-2 text-sm text-muted-foreground">Fale ou digite para organizar sua agenda, serviços, clientes e estoque. Você confere tudo antes de confirmar.</p></div>}
      <div role="log" aria-label="Conversa" aria-live="polite" aria-relevant="additions" className="space-y-3">
        {messages.map((item, index) => <div key={index} className={item.role === 'Você' ? 'ml-6 rounded-xl bg-primary/10 p-3' : 'pr-2'}><strong className="text-xs text-muted-foreground">{item.role}</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p></div>)}
      </div>
      {state?.action_plan ? <div ref={lastResult} tabIndex={-1} aria-label="Ações e resultados" className="space-y-3 focus:outline-none">
        <p className="text-xs text-muted-foreground">{state.action_plan.actions.length} {state.action_plan.actions.length === 1 ? 'ação' : 'ações'} · {state.action_plan.review === 'NORMAL_REVIEW' ? 'Revisão simples' : state.action_plan.review === 'ADVANCED_REVIEW' ? 'Revisão detalhada' : 'Revisão por grupos'}</p>
        {state.action_plan.confirmation_groups.map((group, index) => <section key={group.key} aria-label={`Grupo ${index + 1}`} className="space-y-2">
          {state.action_plan!.confirmation_groups.length > 1 && <h2 className="text-sm font-semibold">Grupo {index + 1}</h2>}
          {group.action_keys.map(key => card(state.action_plan!.actions.find(action => action.key === key)!))}
          {group.status !== 'DONE' && !state.cancelled && !group.action_keys.some(key=>expiredKeys.has(key)) && !group.action_keys.some(key => confirmationBlocked(state.action_plan!.actions.find(action => action.key === key)!)) && !confirmationSuppressed && <Button className="w-full min-h-11" disabled={disabled || group.status !== 'READY_FOR_CONFIRMATION'} onClick={() => {
            if (disabled) return;
            const approval = { plan_ref: state.action_plan!.plan_ref, revision: state.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint };
            void act(() => confirmSecretaryGroup(state.sessionId, approval), 'executing');
          }}>Confirmar{state.action_plan!.confirmation_groups.length > 1 ? ` grupo ${index + 1}` : ''}</Button>}
        </section>)}
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
          {link && <Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href={link.href}>{link.label}</Link>}
        </section>;
      })}</div>}
      {state && [state, ...(state.operations?.map(op => op.state) ?? [])].some(view => view.execution_warnings?.length) && <p className="text-sm">A ação foi registrada, mas houve uma falha técnica posterior. Confira o resultado na tela correspondente.</p>}
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
        <div className="flex flex-wrap items-center gap-2">
          {voiceEnabled && <Button type="button" variant={recording ? 'outline' : 'default'} aria-label={recording ? 'Parar gravação' : 'Falar com a Secretária'} disabled={Boolean(busy || uncertain)} onClick={() => {
            if (recording) { voice.stop(); return; }
            beforeVoice.current = message; setDirty(true); setError(''); voice.start();
          }}>{recording ? <Square className="mr-2 h-4 w-4" aria-hidden="true" /> : <Mic className="mr-2 h-4 w-4" aria-hidden="true" />}{recording ? 'Parar' : voice.phase === 'ready' ? 'Refazer' : 'Falar'}</Button>}
          {recording && <Button type="button" variant="ghost" onClick={() => { voice.cancel(); setMessage(beforeVoice.current); }}>Cancelar gravação</Button>}
          <Button type="submit" className="ml-auto min-h-11" disabled={Boolean(busy || recording || uncertain || !message.trim())}><Send className="mr-2 h-4 w-4" aria-hidden="true" />Enviar</Button>
        </div>
        {voiceEnabled && <p className="text-[11px] text-muted-foreground">{voice.supported ? 'A transcrição usa o serviço de voz do navegador. Revise o texto antes de enviar.' : 'Voz indisponível neste navegador. Use o campo de mensagem.'}</p>}
      </form>}
      {state && !closed && <Button size="sm" variant="ghost" disabled={Boolean(busy || uncertain || recording)} onClick={() => void act(() => cancelSecretary(state.sessionId), 'thinking', true)}>Cancelar conversa</Button>}
    </div>
  </section>;
}
