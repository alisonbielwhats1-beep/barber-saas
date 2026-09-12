"use client";

import { useRef, useState } from "react";
import { testOrchestrator } from "@/app/hq/agents/orchestrator/actions";
import type { ConversationIntent, ConversationMode, OrchestratorResult } from "@everflare/agents/orchestrator";

const names = { TRIAGE: "Triage", SALES: "Sales", CUSTOMER_SUCCESS: "Customer Success", PRODUCT: "Product", OPERATIONS: "Operations", MARKETING: "Marketing", CHIEF: "Chief" };
const statuses = { completed: "Concluído", failed: "Falhou", skipped: "Não acionado" };

export function OrchestratorLab({ ready, reason, dailyLimit = 10 }: { ready: boolean; reason: string; dailyLimit?: number }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<OrchestratorResult | null>(null);
  const [conversationToken, setConversationToken] = useState<string>();
  const [history, setHistory] = useState<{ message: string; result: OrchestratorResult }[]>([]);
  const [mode, setMode] = useState<ConversationMode>("customer");
  const [intent, setIntent] = useState<ConversationIntent>("continue");
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const blocked = uncertain || history.length >= 6 || !!history.at(-1)?.result.pendingApproval;
  function reset() {
    if (busy.current) return;
    setConversationToken(undefined); setHistory([]); setResult(null); setMessage(""); setIntent("continue"); setUncertain(false);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !ready || blocked || !message.trim()) return;
    busy.current = true;
    setPending(true);
    setResult(null);
    try {
      const next = await testOrchestrator(message, { mode, intent, ...(conversationToken ? { conversationToken } : {}) });
      setResult(next);
      if (next.ok) {
        setConversationToken(next.conversationToken);
        setHistory(previous => [...previous, { message, result: next }]);
        setMessage(""); setIntent("continue");
      } else if (next.steps.some(step => step.invoked)) setUncertain(true);
    }
    catch {
      setUncertain(true);
      setResult({ ok: false, steps: [], error: "Não foi possível receber o resultado. Confira sua conexão e as sessões na OpenAI antes de iniciar outra conversa." });
    }
    finally { busy.current = false; setPending(false); }
  }
  return <>
    <header className="hq-heading"><div><span className="hq-agent-eyebrow">EVERFLARE HQ · TESTE INTERNO</span>
      <h1>Orquestrador de agentes</h1><p>Triage classifica a entrada. O responsável mantém a conversa e Chief participa das revisões e decisões.</p>
    </div></header>
    <section className="hq-panel"><strong>Agentes salvos na OpenAI</strong>
      <ul className="hq-orchestrator-agents" aria-label="Sete agentes disponíveis para encaminhamento">
        {Object.entries(names).map(([agent, name]) => <li key={agent} className="hq-badge">{name}</li>)}
      </ul>
      <p>Este teste usa IA real e consome créditos da API. Use mensagens fictícias. A conversa dura até seis mensagens e fica apenas nesta página; recarregar apaga o acesso ao histórico local. As sessões permanecem na OpenAI.</p>
      <p>Somente análise: nenhuma ação externa, alteração no CRM ou transferência humana é executada. A lista indica os destinos configurados; não comprova acesso à API.</p>
      <p>Os agentes recebem o catálogo público de planos desta versão do Everflair. Disponibilidade da oferta Fundador, contratos e serviços dos salões não são consultados.</p>
      {!ready && <p role="status">{reason}</p>}
    </section>
    <div className="hq-agent-workspace">
      <section className="hq-panel"><h2>Enviar uma mensagem de teste</h2>
        <label className="hq-agent-label" htmlFor="orchestrator-mode">Origem da simulação</label>
        <select id="orchestrator-mode" value={mode} disabled={pending || history.length > 0} onChange={event => setMode(event.target.value as ConversationMode)}>
          <option value="customer">Conversa de cliente</option><option value="internal">Solicitação interna</option>
        </select>
        {!!history.length && <><h3>Histórico da simulação</h3><ol aria-label="Histórico da conversa" className="hq-agent-trace">{history.map((turn, index) => <li key={index}>
          <strong>{mode === "customer" ? "Cliente fictício" : "Administrador"}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.message}</p>
          {turn.result.answer ? <><strong>Atendimento Everflair · {turn.result.responder ? names[turn.result.responder] : "Resposta"}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.result.answer}</p></>
            : <p>Resultado interno{turn.result.pendingApproval ? " · aprovação pendente" : ""}. Nenhuma resposta ao cliente foi produzida.</p>}
          {(turn.result.internalReport || turn.result.chiefReport) && <details><summary>Ver análise interna desta mensagem</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.result.chiefReport ?? turn.result.internalReport}</pre></details>}
        </li>)}</ol></>}
        <button type="button" className="hq-button" disabled={pending} onClick={reset}>Nova conversa</button>
        <form onSubmit={submit}>
          {!!conversationToken && <><label className="hq-agent-label" htmlFor="orchestrator-intent">Como tratar esta mensagem</label>
            <select id="orchestrator-intent" value={intent} disabled={pending || blocked} onChange={event => setIntent(event.target.value as ConversationIntent)}>
              <option value="continue">Continuar com o responsável</option><option value="reclassify">Mudou de assunto · reclassificar</option><option value="review">Pedir revisão de Chief</option>
            </select><p>A continuidade não reclassifica a mensagem. Use reclassificação para um novo assunto ou revisão para uma decisão. Sales e Customer Success não sinalizam escalonamento automático no formato salvo.</p></>}
          <label className="hq-agent-label" htmlFor="orchestrator-message">Mensagem</label>
          <textarea id="orchestrator-message" value={message} onChange={event => setMessage(event.target.value)}
            rows={6} maxLength={2000} required disabled={!ready || pending || blocked}
            placeholder="Exemplo: ao tentar remarcar um agendamento, a tela trava." aria-describedby="orchestrator-limit" />
          <p id="orchestrator-limit">{message.length}/2.000 caracteres · 1 teste por minuto por administrador · até {dailyLimit} por 24 horas no projeto{dailyLimit === 50 ? " · limite ampliado do laboratório" : dailyLimit > 10 && " · ampliação temporária para diagnóstico"}</p>
          <button className="hq-button" type="submit" disabled={!ready || pending || blocked || !message.trim()}>{pending ? "Executando fluxo…" : "Testar fluxo"}</button>
        </form>
        <p role="status" aria-live="polite">{pending ? "Aguardando os agentes. O passo a passo aparecerá ao concluir. Prazo de 45 segundos, mais até 2 segundos para solicitar cancelamento." : result?.ok ? "Fluxo concluído." : ""}</p>
        {result?.error && <p role="alert">{result.error}</p>}
        {blocked && <p>Esta simulação não pode continuar: há aprovação pendente, resultado incerto ou o limite de seis mensagens foi atingido. Nova conversa inicia outro cenário, sem aprovar ou executar a pendência anterior.</p>}
      </section>
      <section className="hq-panel" aria-label="Resultado do fluxo" aria-busy={pending}>
        <h2>Resultado da mensagem atual</h2>
        {result?.triage && <div className="hq-orchestrator-decision">
          <p><strong>{result.continued ? "Responsável mantido:" : "Destino selecionado por Triage:"}</strong> {names[result.triage.target_agent]}{result.triage.target_agent === "CHIEF" && " (direto, sem especialista)"}</p>
          <p>Prioridade: {result.triage.priority} · Evento: {result.triage.event_type}</p>
        </div>}
        {(result?.pendingApproval || result?.triage?.requires_human_approval) && <div className="hq-orchestrator-decision" role="status"><strong>Aprovação humana pendente.</strong><p>{result.reviewReason}</p><p>Nenhuma aprovação, ação ou transferência foi executada. Esta pendência é apenas uma simulação nesta página.</p></div>}
        <h3>Resposta para o cliente</h3>
        {result?.ok && result.answer ? <blockquote className="hq-agent-message" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.answer}</blockquote>
          : <p>{pending ? "Preparando o resultado…" : result?.ok ? "Esta etapa produziu uma análise interna; não há mensagem para o cliente." : "A resposta aparecerá após a conclusão do fluxo."}</p>}
        {result?.ok && result.internalReport && <><h3>Análise do especialista · uso interno</h3><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.internalReport}</pre></>}
        {result?.ok && result.chiefReport && <><h3>Chief · para você</h3><p>{result.reviewReason}</p><blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.chiefReport}</blockquote></>}
        <h3>Agentes acionados</h3>
        <p>{result?.steps.length ? result.steps.filter(step => step.sessionId).map(step => names[step.agent]).join(" → ") || "Nenhuma sessão confirmada." : "Triage → responsável selecionado → Chief quando houver revisão"}</p>
        {!!result?.steps.length && <><h3>Resultado de cada agente</h3><ol className="hq-agent-trace">{result.steps.map(step => <li key={step.agent}>
            <strong>{names[step.agent]} · {statuses[step.status]}</strong>
            <p>{step.detail} {step.status !== "skipped" && `${(step.durationMs / 1000).toFixed(1)} s`}</p>
            <details><summary>Ver resultado e identificação</summary>
              <p style={{ overflowWrap: "anywhere" }}>Agente: {step.agentId}</p>
              {step.sessionId && <p style={{ overflowWrap: "anywhere" }}>Sessão: {step.sessionId}</p>}
              {step.output && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{step.output}</pre>}
            </details>
          </li>)}</ol></>}
      </section>
    </div>
  </>;
}
