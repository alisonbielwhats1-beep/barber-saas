"use client";

import { useRef, useState } from "react";
import { agentCatalog, scenarios, statusLabels, type LabResult, type ScenarioId } from "@everflare/agents/catalog";
import { simulateAgent } from "@/app/hq/agents/actions";

export function AgentLab() {
  const [selected, setSelected] = useState<ScenarioId>("overview");
  const [results, setResults] = useState<LabResult[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [progress, setProgress] = useState("");
  const scenario = scenarios.find(s => s.id === selected)!;
  const latest = results[0];

  async function run(ids: readonly ScenarioId[]) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
      try {
        for (let index = 0; index < ids.length; index++) {
          setProgress(`Executando ${index + 1} de ${ids.length}`);
          const response = await simulateAgent(ids[index]);
          if (!response.ok) { setError(response.error); break; }
          setResults(previous => [response.result, ...previous].slice(0, 20));
        }
      } catch {
        setError("Não foi possível executar. Confira sua conexão e tente novamente.");
      } finally {
        setProgress("");
        busy.current = false;
        setPending(false);
      }
  }

  return <>
    <header className="hq-heading"><div><span className="hq-agent-eyebrow">EVERFLARE HQ · LABORATÓRIO</span><h1>Agentes</h1><p>Use os pilotos acima para operar. Os cenários abaixo são demonstrações com dados fictícios.</p></div><span className="hq-agent-pill">Laboratório disponível</span></header>
    <section className="hq-panel hq-agent-notice" aria-label="Modo de operação">
      <strong>Simulação local · sem consumo de IA</strong>
      <p>Os cenários usam respostas programadas e contas fictícias. Validam o SDK e suas permissões; não medem a qualidade do Luna. Nenhum dado de cliente é consultado ou alterado e nenhuma mensagem é enviada.</p>
    </section>
    <div className="hq-agent-team" aria-label="Equipe planejada">
      {agentCatalog.map(agent => <article className="hq-panel" key={agent.id}>
        <span className="hq-agent-eyebrow">{agent.area}</span><h2>{agent.name}</h2><p>{agent.purpose}</p>
        <span className="hq-agent-pill">{agent.available ? "Fluxo em validação" : "Próxima etapa"}</span>
      </article>)}
    </div>
    <div className="hq-agent-workspace">
      <section className="hq-panel">
        <h2>Validar um cenário</h2>
        <label className="hq-agent-label" htmlFor="agent-scenario">Cenário de validação</label>
        <select id="agent-scenario" value={selected} disabled={pending} onChange={event => setSelected(event.target.value as ScenarioId)}>
          {scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <p><strong>Responsável: </strong>{scenario.agent === "chief" ? "Agente Chefe" : "Suporte"}</p>
        <blockquote className="hq-agent-message">{scenario.message}</blockquote>
        <p>{scenario.explanation}</p>
        <div className="hq-actions">
          <button className="hq-button" disabled={pending} onClick={() => run([selected])}>{pending ? "Executando…" : "Executar cenário"}</button>
          <button className="hq-button secondary" disabled={pending} onClick={() => run(scenarios.map(s => s.id))}>Validar os 7 cenários</button>
        </div>
        <p role="status">{progress}</p>
        {error && <p role="alert">{error}</p>}
        <details><summary>O que esta etapa permite</summary><ul>
          <li>Chefe: consulta do resumo executivo fictício.</li>
          <li>Suporte: consulta da própria conta, orientação demonstrativa e rascunho de ticket.</li>
          <li>Sem alterações financeiras, envios ou acesso a outras contas.</li>
          <li>Limite de quatro rodadas por execução.</li>
        </ul></details>
      </section>
      <section className="hq-panel" aria-label="Resultado da execução" aria-busy={pending}>
        <h2>Resultado da execução</h2>
        {!latest ? <div className="hq-empty"><h3>Pronto para validar</h3><p>Escolha um cenário para acompanhar as ferramentas utilizadas e o resultado.</p></div> : <>
          <p><span className="hq-agent-pill">{statusLabels[latest.status]}</span> <strong>{latest.passed ? "Comportamento esperado" : "Revisão necessária"}</strong></p>
          <p>{scenarios.find(s => s.id === latest.scenarioId)?.title}</p>
          <blockquote className="hq-agent-message">{latest.output}</blockquote>
          <div className="hq-agent-stats"><span><b>{latest.turns}</b> rodadas</span><span><b>{latest.externalCalls}</b> chamadas externas</span><span><b>US$ 0</b> consumo de IA</span></div>
          <h3>Passo a passo</h3>
          <ol className="hq-agent-trace">{latest.trace.map(entry => <li key={entry.step}>
            <strong>{entry.status === "allowed" ? "Permitido" : entry.status === "blocked" ? "Bloqueado" : "Falha"} · {entry.tool}</strong>
            <p>{entry.detail}</p>
          </li>)}</ol>
        </>}
      </section>
    </div>
    <section className="hq-panel">
      <div className="hq-actions"><h2>Execuções desta sessão</h2>{results.length > 0 && <button className="hq-button secondary" disabled={pending} onClick={() => setResults([])}>Limpar resultados</button>}</div>
      <p>Até 20 resultados nesta página. Ao recarregar ou sair, eles são descartados e não entram no histórico do CRM.</p>
      {results.length > 0 ? <div className="hq-table-wrap" tabIndex={0} role="region" aria-label="Histórico de simulações"><table><thead><tr><th>Cenário</th><th>Resultado</th><th>Validação técnica</th></tr></thead><tbody>
        {results.map(result => <tr key={result.id}><td>{scenarios.find(s => s.id === result.scenarioId)?.title}</td><td>{statusLabels[result.status]}</td><td>{result.passed ? "Conforme esperado" : "Revisar"}</td></tr>)}
      </tbody></table></div> : <p>Nenhuma execução nesta sessão.</p>}
    </section>
    <section className="hq-panel"><h2>Caminho para ativação</h2><ol className="hq-agent-roadmap">
      <li><strong>Fundação · SDK e permissões</strong><span>Cenários fictícios para verificar limites e encaminhamentos.</span></li>
      <li><strong>Pilotos · Chefe e Suporte</strong><span>Consulta do HQ, base de conhecimento, rascunhos revisados e orçamento compartilhado. Disponibilidade indicada em cada piloto.</span></li>
      <li><strong>Em seguida · WhatsApp</strong><span>Texto, prints e áudio; caixa de entrada com opção de assumir a conversa.</span></li>
      <li><strong>Por último · Autonomia gradual</strong><span>Qualidade medida, ações autorizadas e controle de custos.</span></li>
    </ol></section>
  </>;
}
