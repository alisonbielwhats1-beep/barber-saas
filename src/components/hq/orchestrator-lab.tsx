"use client";

import { useRef, useState } from "react";
import { testOrchestrator } from "@/app/hq/agents/orchestrator/actions";
import type { OrchestratorResult } from "@everflare/agents/orchestrator";

const names = { TRIAGE: "Triage", SALES: "Sales", CUSTOMER_SUCCESS: "Customer Success", PRODUCT: "Product", OPERATIONS: "Operations", MARKETING: "Marketing", CHIEF: "Chief" };
const statuses = { completed: "Concluído", failed: "Falhou", skipped: "Não acionado" };

export function OrchestratorLab({ ready, reason, dailyLimit = 10 }: { ready: boolean; reason: string; dailyLimit?: number }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<OrchestratorResult | null>(null);
  const busy = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !ready || !message.trim()) return;
    busy.current = true;
    setPending(true);
    setResult(null);
    try { setResult(await testOrchestrator(message)); }
    catch { setResult({ ok: false, steps: [], error: "Não foi possível receber o resultado. Confira sua conexão antes de repetir o teste." }); }
    finally { busy.current = false; setPending(false); }
  }
  return <>
    <header className="hq-heading"><div><span className="hq-agent-eyebrow">EVERFLARE HQ · TESTE INTERNO</span>
      <h1>Orquestrador de agentes</h1><p>Triage classifica, um especialista analisa e Chief prepara a resposta final. Quando indicado, Chief recebe diretamente.</p>
    </div></header>
    <section className="hq-panel"><strong>Agentes salvos na OpenAI</strong>
      <ul className="hq-orchestrator-agents" aria-label="Sete agentes disponíveis para encaminhamento">
        {Object.entries(names).map(([agent, name]) => <li key={agent} className="hq-badge">{name}</li>)}
      </ul>
      <p>Este teste usa IA real e consome créditos da API. Use uma mensagem fictícia. Os resultados ficam nesta página até o próximo teste ou recarregamento; as sessões também ficam na OpenAI.</p>
      <p>Somente análise: nenhuma ação externa, alteração no CRM ou transferência humana é executada. A lista indica os destinos configurados; não comprova acesso à API.</p>
      {!ready && <p role="status">{reason}</p>}
    </section>
    <div className="hq-agent-workspace">
      <section className="hq-panel"><h2>Enviar uma mensagem de teste</h2>
        <form onSubmit={submit}>
          <label className="hq-agent-label" htmlFor="orchestrator-message">Mensagem</label>
          <textarea id="orchestrator-message" value={message} onChange={event => setMessage(event.target.value)}
            rows={6} maxLength={2000} required disabled={!ready || pending}
            placeholder="Exemplo: ao tentar remarcar um agendamento, a tela trava." aria-describedby="orchestrator-limit" />
          <p id="orchestrator-limit">{message.length}/2.000 caracteres · 1 teste por minuto por administrador · até {dailyLimit} por 24 horas no projeto{dailyLimit > 10 && " · ampliação temporária para diagnóstico"}</p>
          <button className="hq-button" type="submit" disabled={!ready || pending || !message.trim()}>{pending ? "Executando fluxo…" : "Testar fluxo"}</button>
        </form>
        <p role="status" aria-live="polite">{pending ? "Aguardando os agentes. O passo a passo aparecerá ao concluir. Prazo de 45 segundos, mais até 2 segundos para solicitar cancelamento." : result?.ok ? "Fluxo concluído." : ""}</p>
        {result?.error && <p role="alert">{result.error}</p>}
      </section>
      <section className="hq-panel" aria-label="Resultado do fluxo" aria-busy={pending}>
        <h2>Resposta final de Chief</h2>
        {result?.triage && <div className="hq-orchestrator-decision">
          <p><strong>Destino selecionado por Triage:</strong> {names[result.triage.target_agent]}{result.triage.target_agent === "CHIEF" && " (direto, sem especialista)"}</p>
          <p>Prioridade: {result.triage.priority} · Evento: {result.triage.event_type}</p>
          {result.triage.requires_human_approval && <p role="status"><strong>Aprovação humana pendente.</strong> Nenhuma aprovação, ação ou transferência foi executada.</p>}
        </div>}
        {result?.ok && result.answer ? <blockquote className="hq-agent-message" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.answer}</blockquote>
          : <p>{pending ? "Preparando a resposta…" : "A resposta aparecerá após a conclusão do fluxo."}</p>}
        <h3>Agentes acionados</h3>
        <p>{result?.steps.length ? result.steps.filter(step => step.sessionId).map(step => names[step.agent]).join(" → ") || "Nenhuma sessão confirmada." : "Triage → especialista selecionado, quando necessário → Chief"}</p>
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
