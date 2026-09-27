// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import type { SecretaryView } from '../salon-secretary';
const mocks = vi.hoisted(() => ({ start: vi.fn(), send: vi.fn(), confirm: vi.fn(), group: vi.fn(), cancel: vi.fn(), select: vi.fn(), selectCustomer: vi.fn(), selectOperation: vi.fn(), confirmOperation: vi.fn(), refresh: vi.fn(), resume: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('../../app/(admin)/servicos/secretaria/actions', () => ({ resumeSecretaryPlan: mocks.resume, startSecretary: mocks.start, sendSecretary: mocks.send, confirmSecretary: mocks.confirm, confirmSecretaryGroup: mocks.group, cancelSecretary: mocks.cancel, selectSecretaryService: mocks.select, selectSecretaryCustomer: mocks.selectCustomer, selectSecretaryOperation: mocks.selectOperation, confirmSecretaryOperation: mocks.confirmOperation }));
import { SecretaryChat } from '../../app/(admin)/servicos/secretaria/secretary-chat';
const base: SecretaryView = { sessionId: 'session', cancelled: false, message: 'Como posso ajudar?' };
const proposal = { proposal_ref: 'proposal', draft_ref: 'draft', draft_revision: 1, payload_hash: 'hash', expires_at: '2099-01-01T00:00:00Z', preview: 'Massagem\nR$ 100,00 → R$ 80,00', change: { before: { priceCents: 10000 } } };
function planned(count = 1): SecretaryView {
  let actionPlan = createActionPlan(plan(Array.from({ length: count }, (_, i) => intent('service.change', { item_key: `a${i}`, target_name: `Massagem ${i + 1}`, priceCents: 8000 }))));
  for (const action of actionPlan.actions) actionPlan = assessPlanAction(actionPlan, action.key, { status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview: proposal.preview, proposal_token: action.key });
  return { ...base, action_plan: actionPlan, operations: actionPlan.actions.map(action => ({ operation_ref: `op-${action.key}`, action_keys: [action.key], state: { ...base, proposal } as unknown as SecretaryView })) };
}
function completed(view: SecretaryView, failed = -1): SecretaryView {
  const next = structuredClone(view);
  next.action_plan!.actions.forEach((action, i) => {
    next.action_plan = assessPlanAction(next.action_plan!, action.key, { status: i === failed ? 'FAILED_SAFE' : 'DONE', missing_fields: [], preview: i === failed ? 'Horário indisponível.' : 'Concluído.' });
    if (i !== failed) next.operations![i].state.receipt = { service: { id: `secret-id-${i}`, name: `Massagem ${i + 1}`, priceCents: 8000, durationMin: 30 } } as SecretaryView['receipt'];
  });
  return next;
}
const ok = (state: SecretaryView) => ({ ok: true, state });
beforeEach(() => { vi.resetAllMocks(); mocks.start.mockResolvedValue(ok(base)); mocks.cancel.mockResolvedValue(ok({ ...base, cancelled: true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view = base) { mocks.start.mockResolvedValue(ok(view)); const user = userEvent.setup(); render(<SecretaryChat />); await user.click(screen.getByRole('button', { name: 'Nova conversa' })); return user; }

describe('Secretary front, same confirmation and receipt authority', () => {
  it.each(['UNSUPPORTED','AMBIGUOUS'] as const)('shows %s without a fictitious action or confirmation', async capability_status => {
    const message=capability_status==='UNSUPPORTED'?'Ainda não consigo cadastrar ou alterar profissionais pela Secretária.':'Qual ação deseja realizar?';
    await open({...base,skill:'auto',capability_status,message});
    expect(screen.getByRole('log')).toHaveTextContent(message);
    expect(screen.queryByText('Vamos preparar sua ação')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Confirmar/})).not.toBeInTheDocument();
    expect(screen.queryByRole('region',{name:'Operação 1'})).not.toBeInTheDocument();
  });
  it('sends text through the existing pipeline and displays a natural missing-field question', async () => {
    const user = await open(); mocks.send.mockResolvedValue(ok({ ...base, message: 'Qual serviço o Fábio vai fazer?' }));
    await user.type(screen.getByLabelText('Mensagem'), 'Agende Fábio'); await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'Agende Fábio' });
    expect(screen.getByRole('log')).toHaveTextContent('Qual serviço o Fábio vai fazer?'); expect(mocks.group).not.toHaveBeenCalled();
  });
  it.each([1, 2, 5, 10, 11, 12, 14])('renders %i actions without imposing another structural cap', async count => {
    await open(planned(count)); expect(screen.getAllByRole('article')).toHaveLength(count);
    expect(screen.getAllByRole('button', { name: /^Confirmar/ })).toHaveLength(count > 10 ? 2 : 1);
    expect(screen.getByText(count > 10 ? /Revisão por grupos/ : count > 5 ? /Revisão detalhada/ : /Revisão simples/)).toBeVisible();
  });
  it('confirms only the exact backend group and refreshes after a real receipt', async () => {
    const view = planned(), user = await open(view); mocks.group.mockResolvedValue(ok(completed(view)));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    const p = view.action_plan!, g = p.confirmation_groups[0];
    expect(mocks.group).toHaveBeenCalledExactlyOnceWith('session', { plan_ref: p.plan_ref, revision: p.revision, group_key: g.key, fingerprint: g.fingerprint });
    expect(mocks.refresh).toHaveBeenCalledOnce(); expect(screen.getByRole('article')).toHaveTextContent('R$ 100,00 → R$ 80,00');
    expect(screen.getByRole('link', { name: 'Ver serviços' })).toHaveAttribute('href', '/servicos');
    expect(document.body.textContent).not.toContain('secret-id'); expect(mocks.confirmOperation).not.toHaveBeenCalled();
  });
  it('editing immediately disables the old proposal; only a new returned version enables confirmation', async () => {
    const view = planned(), user = await open(view); await user.type(screen.getByLabelText('Mensagem'), 'Na verdade R$90.');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    const updated = planned(); updated.action_plan!.revision += 1; mocks.send.mockResolvedValue(ok(updated));
    await user.click(screen.getByRole('button', { name: 'Enviar' })); expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    expect(mocks.group).not.toHaveBeenCalled();
  });
  it('stale denial cannot leave an executable old button or claim success', async () => {
    const user = await open(planned()); mocks.group.mockResolvedValue({ ok: false, code: 'CONFIRMATION_STALE', error: 'Esta proposta foi substituída.' });
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('substituída'); expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('replaces a stale card with the new proposal and renders only the authoritative receipt', async () => {
    const user = await open(planned());
    await user.type(screen.getByLabelText('Mensagem'), 'Na verdade R$90.');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    const revised = planned(); revised.action_plan!.revision++;
    const preview = 'Massagem\nR$ 100,00 → R$ 90,00';
    revised.action_plan = assessPlanAction(revised.action_plan!, revised.action_plan!.actions[0].key, { status: 'READY_FOR_CONFIRMATION', missing_fields: [], preview, proposal_token: 'revised' });
    revised.operations![0].state.proposal = { ...proposal, draft_revision: 2, preview } as SecretaryView['proposal'];
    mocks.send.mockResolvedValue(ok(revised)); await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const final = completed(revised); final.operations![0].state.receipt = { service: { id: 'hidden', name: 'Massagem', priceCents: 9000, durationMin: 30 } } as SecretaryView['receipt'];
    mocks.group.mockResolvedValue(ok(final)); await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('article')).toHaveTextContent('90,00'); expect(screen.getByRole('article')).not.toHaveTextContent('80,00');
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument(); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('announces execution and waits for the receipt before reporting success', async () => {
    const view = planned(), user = await open(view);
    let finish!: (value: unknown) => void; mocks.group.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Executando'); expect(screen.getByRole('article')).not.toHaveTextContent('Concluído');
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => finish(ok(completed(view)))); expect(screen.getByRole('article')).toHaveTextContent('Concluído');
  });
  it('lost confirmation response retries the same key; no concurrent double click', async () => {
    const view = planned(), user = await open(view); mocks.group.mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(ok(completed(view)));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Não presuma sucesso'); expect(screen.getByLabelText('Mensagem')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Verificar resultado' }));
    expect(mocks.group.mock.calls[0]).toEqual(mocks.group.mock.calls[1]); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('partial result keeps each receipt separate and never claims everything completed', async () => {
    const view = planned(3), user = await open(view); mocks.group.mockResolvedValue(ok(completed(view, 1)));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    const cards = screen.getAllByRole('article'); expect(cards[0]).toHaveTextContent('Concluído'); expect(cards[1]).toHaveTextContent('Não concluído'); expect(cards[2]).toHaveTextContent('Concluído');
    expect(screen.getByRole('status')).toHaveTextContent('cada ação'); expect(mocks.refresh).toHaveBeenCalledOnce(); expect(document.body.textContent).not.toContain('Tudo concluído');
  });
  it('ambiguous customers require a visual choice and hide raw identifiers', async () => {
    const view = { ...base, customer: { candidates: [{ id: 'private-one', name: 'Amanda Souza', phone: '(11) *****-1234' }, { id: 'private-two', name: 'Amanda Ribeiro', phone: null }] } } as unknown as SecretaryView;
    const user = await open(view); expect(mocks.selectCustomer).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('private-');
    mocks.selectCustomer.mockResolvedValue(ok(base)); await user.click(screen.getByRole('button', { name: 'Amanda Ribeiro' })); expect(mocks.selectCustomer).toHaveBeenCalledWith('session', 'private-two');
  });
  it('HARD_BLOCK exposes only backend alternatives and no override control', async () => {
    const view = planned(); const action = view.action_plan!.actions[0]; view.action_plan = assessPlanAction(view.action_plan!, action.key, { status: 'DOMAIN_CONFLICT', missing_fields: ['destination_mode'], preview: 'Salão fechado.' });
    view.operations![0].state = { ...base, scheduling: { draft: { review: { status: 'CONFLICT_HARD_BLOCK', message: 'Salão fechado.', override_allowed: false, alternatives: [{ startLocal: '2030-01-02T11:00' }] } } } } as unknown as SecretaryView;
    await open(view); expect(screen.getByText('Este horário não pode ser usado')).toBeVisible(); expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /encaix|override/i })).not.toBeInTheDocument(); expect(screen.getByText(/Alternativas disponíveis/)).toHaveTextContent('2030-01-02 às 11:00');
  });
  it('provider failure preserves editable text and never refreshes or claims mutation', async () => {
    const user = await open(); mocks.send.mockResolvedValue({ ok: false, error: 'Provedor indisponível.' }); await user.type(screen.getByLabelText('Mensagem'), 'Altere Massagem'); await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Altere Massagem'); expect(screen.getByRole('alert')).toHaveTextContent('indisponível'); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(['service', 'inventory', 'scheduling'])('legacy %s transport still requires proposal and refreshes only receipt', async kind => {
    const child = { ...base, ...(kind === 'service' ? { proposal } : { [kind]: { proposal } }) } as SecretaryView;
    const root = { ...base, operations: [{ operation_ref: 'child', state: child }] }, user = await open(root);
    const receipt = kind === 'service' ? { service: { id: 'hidden', name: 'Massagem', priceCents: 8000, durationMin: 30 } } : kind === 'inventory' ? { stock: 8, previous_stock: 10 } : { appointment_ref: 'hidden', outcome: 'RESCHEDULED' };
    mocks.confirmOperation.mockResolvedValue(ok({ ...base, operations: [{ operation_ref: 'child', state: { ...base, ...(kind === 'service' ? { receipt } : { [kind]: { receipt } }) } as SecretaryView }] }));
    await user.click(screen.getByRole('button', { name: /^Confirmar/ })); expect(mocks.confirmOperation).toHaveBeenCalledWith('session', 'child', { proposal_ref: 'proposal', draft_revision: 1 }); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('keyboard submits text without confirming proposals', async () => {
    const user = await open(); mocks.send.mockResolvedValue(ok(planned())); screen.getByLabelText('Mensagem').focus(); await user.keyboard('Altere Massagem'); await user.tab(); expect(screen.getByRole('button', { name: 'Enviar' })).toHaveFocus(); await user.keyboard('{Enter}'); expect(mocks.send).toHaveBeenCalledOnce(); expect(mocks.group).not.toHaveBeenCalled();
  });
});
class Recognition {
  static current: Recognition; lang = ''; continuous = false; interimResults = false;
  onstart?: () => void; onend?: () => void; onresult?: (e: unknown) => void; onerror?: (e: { error: string }) => void;
  constructor() { Recognition.current = this; } start() { this.onstart?.(); } stop() { this.onend?.(); } abort() {}
}
describe('voice adapter never executes or sends audio as an action', () => {
  beforeEach(() => vi.stubGlobal('SpeechRecognition', Recognition));
  it('keeps capture pending until the browser starts listening, without sending', async () => {
    class PendingPermission extends Recognition { start() {} }
    vi.stubGlobal('SpeechRecognition', PendingPermission);
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />);
    expect(screen.getByRole('status')).toHaveTextContent('Fale ou escreva');
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    expect(screen.getByRole('button', { name: 'Cancelar gravação' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Transcrevendo');
    act(() => Recognition.current.onstart?.()); expect(screen.getByRole('status')).toHaveTextContent('Ouvindo');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('unavailable native STT provides an explicit typed fallback', async () => {
    vi.stubGlobal('SpeechRecognition', undefined); vi.stubGlobal('webkitSpeechRecognition', undefined);
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />);
    expect(screen.getByText('Voz indisponível neste navegador. Use o campo de mensagem.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    expect(screen.getByRole('alert')).toHaveTextContent('não está disponível');
    await user.type(screen.getByLabelText('Mensagem'), 'Mensagem digitada'); expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('shows editable transcript, supports manual send and uses the same pipeline', async () => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />); await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    act(() => Recognition.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Altera Massagem para R$80' } }] }));
    await user.click(screen.getByRole('button', { name: 'Parar gravação' })); expect(screen.getByLabelText('Mensagem')).toHaveValue('Altera Massagem para R$80'); expect(mocks.send).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Mensagem')); await user.type(screen.getByLabelText('Mensagem'), 'Altera Massagem para R$90'); mocks.send.mockResolvedValue(ok(planned()));
    await user.click(screen.getByRole('button', { name: 'Enviar' })); expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'session', message: 'Altera Massagem para R$90' }); expect(mocks.group).not.toHaveBeenCalled();
  });
  it.each(['not-allowed', 'network', 'no-speech'])('makes STT %s failure visible with text fallback', async error => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />); await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' })); act(() => Recognition.current.onerror?.({ error })); expect(screen.getByRole('alert')).toBeVisible(); expect(screen.getByLabelText('Mensagem')).toBeEnabled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('cancel recording discards late recognition events and restores typed text', async () => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />); await user.type(screen.getByLabelText('Mensagem'), 'Preserve'); await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' })); const old = Recognition.current;
    await user.click(screen.getByRole('button', { name: 'Cancelar gravação' })); act(() => old.onresult?.({ results: [{ 0: { transcript: 'late' } }] })); expect(screen.getByLabelText('Mensagem')).toHaveValue('Preserve'); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('retries after no-speech and keeps the recovered transcript manual and editable', async () => {
    const user = userEvent.setup(); render(<SecretaryChat voiceEnabled />);
    expect(screen.getByRole('button', { name: 'Falar com a Secretária' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    const old = Recognition.current; act(() => old.onerror?.({ error: 'no-speech' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Não ouvi uma fala');
    await user.click(screen.getByRole('button', { name: 'Falar com a Secretária' }));
    expect(Recognition.current).not.toBe(old);
    expect(screen.getByRole('button', { name: 'Parar gravação' })).toBeVisible();
    act(() => Recognition.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Massagem noventa reais' } }] }));
    await user.click(screen.getByRole('button', { name: 'Parar gravação' }));
    expect(screen.getByLabelText('Mensagem')).toHaveValue('Massagem noventa reais');
    expect(screen.getByLabelText('Mensagem')).toBeEnabled(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.group).not.toHaveBeenCalled();
  });
  it('does not speak without an explicit click; remote voices are not used', async () => {
    const speak = vi.fn(); vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak, getVoices: () => [{ lang: 'pt-BR', localService: false }] });
    const user = await open(); expect(speak).not.toHaveBeenCalled(); await user.click(screen.getByRole('button', { name: 'Ouvir resposta curta' })); expect(speak).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('não disponível');
  });
  it('short TTS uses a local voice only after a click and never confirms', async () => {
    const speak = vi.fn(), voice = { lang: 'pt-BR', localService: true };
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak, getVoices: () => [voice] });
    vi.stubGlobal('SpeechSynthesisUtterance', class { voice?: unknown; lang?: string; constructor(public text: string) {} });
    const user = await open(); expect(speak).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Ouvir resposta curta' }));
    expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'Como posso ajudar?', voice, lang: 'pt-BR' }));
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
});


it('can leave selected action and resume a preserved plan without confirmation', async()=>{
  const view=planned(),old=planned();view.suspended_plans=[{plan_ref:old.action_plan!.plan_ref,label:'service.change'}];
  const user=await open(view);
  await user.click(screen.getByRole('button',{name:'Alterar / responder a esta ação'}));
  expect(screen.getByText('Respondendo à ação selecionada.')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'Sair da seleção'}));
  expect(screen.queryByText('Respondendo à ação selecionada.')).not.toBeInTheDocument();
  mocks.resume.mockResolvedValue(ok(old));
  await user.click(screen.getByRole('button',{name:/^Retomar /}));
  expect(mocks.resume).toHaveBeenCalledWith('session',old.action_plan!.plan_ref);
  expect(mocks.group).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
});
it('shows unsupported reply even when an earlier plan is ready',async()=>{
  const user=await open(planned());
  mocks.send.mockResolvedValue(ok({...planned(),capability_status:'UNSUPPORTED',message:'Ainda não consigo cadastrar profissionais pela Secretária.'}));
  await user.type(screen.getByLabelText('Mensagem'),'Cadastre uma profissional.');
  await user.click(screen.getByRole('button',{name:'Enviar'}));
  expect(screen.getByRole('log')).toHaveTextContent('Ainda não consigo cadastrar profissionais');
  expect(mocks.group).not.toHaveBeenCalled();
});

it("keeps natural conversation available after a completed operational plan",async()=>{
  const view=planned();view.action_plan!.status="DONE";view.action_plan!.actions[0].status="DONE";
  view.action_plan!.confirmation_groups[0].status="DONE";view.skill="auto";
  const user=await open(view);
  expect(screen.getByLabelText("Mensagem")).toBeEnabled();
  mocks.send.mockResolvedValue(ok({...base,skill:"auto",capability_status:"CONVERSATION",message:"Bom dia!"}));
  await user.type(screen.getByLabelText("Mensagem"),"Oi de novo.");
  await user.click(screen.getByRole("button",{name:"Enviar"}));
  expect(mocks.send).toHaveBeenCalledWith({sessionId:"session",message:"Oi de novo."});
  expect(screen.queryByText("Vamos preparar sua ação")).not.toBeInTheDocument();expect(mocks.group).not.toHaveBeenCalled();
});
it.each(["FAILED_SAFE","UNSUPPORTED"] as const)("does not offer confirmation on a %s action",async status=>{
  const view=planned();view.action_plan!.actions[0].status=status;view.action_plan!.confirmation_groups[0].status="NEEDS_REVIEW";
  await open(view);expect(screen.queryByRole("button",{name:"Confirmar"})).not.toBeInTheDocument();
});

it("withdraws confirmation when an open page reaches the backend proposal deadline",async()=>{
  vi.useFakeTimers();
  try{
    const view=planned();view.operations![0].state.proposal={...proposal,expires_at:new Date(Date.now()+1000).toISOString()} as SecretaryView['proposal'];
    mocks.start.mockResolvedValue(ok(view));
    render(<SecretaryChat />);
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Nova conversa'}));});
    expect(screen.getByRole('button',{name:'Confirmar'})).toBeEnabled();
    await act(async()=>{await vi.advanceTimersByTimeAsync(1001);});
    expect(screen.queryByRole('button',{name:'Confirmar'})).not.toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Proposta expirada');
    expect(mocks.group).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
});


it.each([11,14])('keeps the independently ready group executable after a partial failure among %i actions',async count=>{
  const view=planned(count),user=await open({...view,skill:'auto',capability_status:'SUPPORTED'});
  const partial=structuredClone(view);partial.skill='auto';partial.capability_status='SUPPORTED';
  for(const [index,key] of partial.action_plan!.confirmation_groups[0].action_keys.entries()){
    partial.action_plan=assessPlanAction(partial.action_plan!,key,{status:index===0?'FAILED_SAFE':'DONE',missing_fields:[],preview:index===0?'Falha segura.':'Concluído.'});
    if(index>0)partial.operations![index].state.receipt={service:{id:'hidden',name:'Massagem',priceCents:8000,durationMin:30}} as SecretaryView['receipt'];
  }
  mocks.group.mockResolvedValueOnce(ok(partial));
  await user.click(screen.getByRole('button',{name:'Confirmar grupo 1'}));
  expect(screen.queryByRole('button',{name:'Confirmar grupo 1'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Confirmar grupo 2'})).toBeEnabled();
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Não concluído');
  const p=partial.action_plan!,g=p.confirmation_groups[1];
  const final=structuredClone(partial);
  for(const key of g.action_keys)final.action_plan=assessPlanAction(final.action_plan!,key,{status:'DONE',missing_fields:[],preview:'Concluído.'});
  final.capability_status='BLOCKED';
  mocks.group.mockResolvedValueOnce(ok(final));
  await user.click(screen.getByRole('button',{name:'Confirmar grupo 2'}));
  expect(mocks.group).toHaveBeenLastCalledWith('session',{plan_ref:p.plan_ref,revision:p.revision,group_key:g.key,fingerprint:g.fingerprint});
  expect(screen.queryByRole('button',{name:/^Confirmar/})).not.toBeInTheDocument();
  expect(mocks.group).toHaveBeenCalledTimes(2);
});
it.each(['BLOCKED','UNSUPPORTED','AMBIGUOUS','CONVERSATION'] as const)('an explicit %s disposition still withdraws every ready group',async capability_status=>{
  await open({...planned(11),capability_status});
  expect(screen.queryByRole('button',{name:/^Confirmar/})).not.toBeInTheDocument();
  expect(mocks.group).not.toHaveBeenCalled();
});
it.each(['FAILED_SAFE','UNSUPPORTED','DOMAIN_CONFLICT','BLOCKED_BY_DEPENDENCY'] as const)('never exposes confirmation for a %s member even if a stale group says ready',async status=>{
  const view=planned(11);view.capability_status='SUPPORTED';view.action_plan!.actions[0].status=status;
  await open(view);
  expect(screen.queryByRole('button',{name:'Confirmar grupo 1'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Confirmar grupo 2'})).toBeEnabled();
  expect(mocks.group).not.toHaveBeenCalled();
});
