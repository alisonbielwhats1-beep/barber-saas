"use client";

import { useRef, useState } from "react";
import { testOrchestrator } from "@/app/hq/agents/orchestrator/actions";
import type { OrchestratorResult } from "@everflare/agents/orchestrator";

const names = { TRIAGE: "Triage", PRODUCT: "Product", CHIEF: "Chief" };
const statuses = { completed: "Concluído", failed: "Falhou", skipped: "Não acionado" };

export function OrchestratorLab({ ready, reason }: { ready: boolean; reason: string }) {
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
      <h1>Orquestrador de agentes</h1><p>Triage recebe a mensagem, Product analisa assuntos de produto e Chief prepara a resposta final.</p>
    </div></header>
    <section className="hq-panel"><strong>Agentes salvos na OpenAI</strong>
      <p>Este teste usa IA real e consome créditos da API. Use uma mensagem fictícia. Os resultados ficam nesta página até o próximo teste ou recarregamento; as sessões também ficam na OpenAI.</p>
      {!ready && <p role="status">{reason}</p>}
    </section>
    <div className="hq-agent-workspace">
      <section className="hq-panel"><h2>Enviar uma mensagem de teste</h2>
        <form onSubmit={submit}>
          <label className="hq-agent-label" htmlFor="orchestrator-message">Mensagem</label>
          <textarea id="orchestrator-message" value={message} onChange={event => setMessage(event.target.value)}
            rows={6} maxLength={2000} required disabled={!ready || pending}
            placeholder="Exemplo: ao tentar remarcar um agendamento, a tela trava." aria-describedby="orchestrator-limit" />
          <p id="orchestrator-limit">{message.length}/2.000 caracteres · até 10 testes por dia</p>
          <button className="hq-button" type="submit" disabled={!ready || pending || !message.trim()}>{pending ? "Executando fluxo…" : "Testar fluxo"}</button>
        </form>
        <p role="status" aria-live="polite">{pending ? "Aguardando os agentes. O passo a passo aparecerá ao concluir, em até 45 segundos." : result?.ok ? "Fluxo concluído." : ""}</p>
        {result?.error && <p role="alert">{result.error}</p>}
      </section>
      <section className="hq-panel" aria-label="Resultado do fluxo" aria-busy={pending}>
        <h2>Resposta final de Chief</h2>
        {result?.ok && result.answer ? <blockquote className="hq-agent-message" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.answer}</blockquote>
          : <p>{pending ? "Preparando a resposta…" : "A resposta aparecerá após a conclusão do fluxo."}</p>}
        <h3>Agentes acionados</h3>
        {!result?.steps.length ? <p>Triage → Product, quando necessário → Chief</p>
          : <ol className="hq-agent-trace">{result.steps.map(step => <li key={step.agent}>
            <strong>{names[step.agent]} · {statuses[step.status]}</strong>
            <p>{step.detail} {step.status !== "skipped" && `${(step.durationMs / 1000).toFixed(1)} s`}</p>
            <details><summary>Ver resultado e identificação</summary>
              <p style={{ overflowWrap: "anywhere" }}>Agente: {step.agentId}</p>
              {step.sessionId && <p style={{ overflowWrap: "anywhere" }}>Sessão: {step.sessionId}</p>}
              {step.output && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{step.output}</pre>}
            </details>
          </li>)}</ol>}
      </section>
    </div>
  </>;
}
