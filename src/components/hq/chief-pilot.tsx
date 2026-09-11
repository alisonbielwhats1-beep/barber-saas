"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { askChiefAction, chiefHistoryAction } from "@/app/hq/agents/chief-actions";
import { chiefSuggestions, type ChiefState } from "@/lib/hq/chief-contract";

const usd=(micros:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"USD",minimumFractionDigits:4,maximumFractionDigits:4}).format(micros/1000000);
const date=(value:string)=>new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date(value));
export function ChiefPilot({initial}:{initial:ChiefState}) {
 const [state,setState]=useState(initial),[question,setQuestion]=useState(""),[pending,setPending]=useState(false),[error,setError]=useState("");
 const busy=useRef(false);
 // Manter ID após falha de transporte: repetir a mesma pergunta não duplica consumo.
 const attempt=useRef<{id:string;question:string}|null>(null);
 async function refresh(cursor?:string) {
  if(busy.current)return;
  busy.current=true;setPending(true);setError("");
  try {setState(await chiefHistoryAction(cursor));} catch {setError("Não foi possível atualizar. Confira a conexão e sua sessão.");}
  finally {busy.current=false;setPending(false);}
 }
 async function send() {
  if(busy.current||!state.ready)return;
  busy.current=true;setPending(true);setError("");
  const clean=question.trim();
  if(attempt.current?.question!==clean)attempt.current={id:crypto.randomUUID(),question:clean};
  try {
   const response=await askChiefAction(attempt.current);
   if(!response.ok){setError(response.error);return;}
   setState(previous=>({...previous,runs:[response.run,...previous.runs.filter(r=>r.id!==response.run.id)].slice(0,30)}));
   if(response.run.status!=="running")attempt.current=null;
   try {setState(await chiefHistoryAction());}catch {setError("Resposta recebida. Atualize o histórico para conferir o orçamento.");}
  }catch {setError("Conexão interrompida. Atualize o histórico; reenviar a mesma pergunta reutiliza a solicitação.");}
  finally {busy.current=false;setPending(false);}
 }
 return <section className="hq-panel hq-chief" aria-label="Piloto do Agente Chefe">
  <div className="hq-heading"><div><span className="hq-agent-eyebrow">PILOTO · SOMENTE LEITURA</span><h2>Converse com o Agente Chefe</h2><p>Consulte sua operação no HQ e confira as fontes.</p></div><span className="hq-agent-pill">{state.ready?"Disponível":"Aguardando ativação"}</span></div>
  {!state.ready&&<p role="status">{state.reason}</p>}
  <p>Cada pergunta usa dados atualizados e é independente das anteriores. Nenhum cadastro é alterado. As respostas usam IA e devem ser conferidas nas fontes.</p>
  <div className="hq-actions">{chiefSuggestions.map(s=><button type="button" className="hq-button secondary" disabled={pending} key={s} onClick={()=>setQuestion(s)}>{s}</button>)}</div>
  <form onSubmit={e=>{e.preventDefault();void send();}}>
   <label className="hq-agent-label" htmlFor="chief-question">Sua pergunta</label>
   <textarea id="chief-question" rows={3} value={question} onChange={e=>setQuestion(e.target.value)} minLength={3} maxLength={1000} required disabled={pending||!state.ready} placeholder="Como está o financeiro do Everflare?" />
   <p>O resumo do HQ e sua pergunta serão enviados à OpenAI. Não inclua senhas ou chaves de acesso.</p>
   <button className="hq-button" disabled={pending||!state.ready||question.trim().length<3}>{pending?"Consultando…":"Consultar Chefe"}</button>
  </form>
  <p role="alert">{error}</p>
  <p>Orçamento mensal: <strong>{usd(state.budgetMicros)}</strong> · Estimado e reservado: <strong>{usd(state.committedMicros)}</strong>. Até 20 consultas/dia UTC; uma por vez. Falhas podem manter uma reserva de US$ 0,025.</p>
  <div className="hq-actions"><h3>Histórico persistente</h3><button type="button" className="hq-button secondary" disabled={pending} onClick={()=>refresh()}>Atualizar histórico</button></div>
  {state.runs.length===0?<p>Nenhuma consulta registrada nesta página.</p>:<ol className="hq-chief-history">{state.runs.map(run=><li key={run.id}>
   <p><strong>{run.question}</strong></p><p>{date(run.createdAt)} · {run.status==="completed"?"Concluída":run.status==="running"?"Em andamento":"Não concluída"} · {usd(run.chargeMicros)} {run.status==="completed"?"estimados":"reservados"}</p>
   {run.answer&&<p className="hq-chief-answer">{run.answer}</p>}
   {run.status==="failed"&&<p>Não houve resposta confirmada. A reserva foi mantida por segurança; confira o consumo do provedor antes de reconciliar.</p>}
   <nav aria-label="Fontes da consulta" className="hq-actions">{run.sources.map(source=><Link href={source.href} key={source.href}>{source.label}</Link>)}</nav>
   <details><summary>Detalhes da execução</summary><p>{run.model} · {run.promptVersion}</p><p>Entrada: {run.inputTokens??"indisponível"} tokens · Saída: {run.outputTokens??"indisponível"} tokens</p><p>Consulta: {run.id}</p><p>As fontes abrem os dados atuais; a resposta corresponde à consulta em {date(run.createdAt)}.</p></details>
  </li>)}</ol>}
  {state.nextCursor&&<button className="hq-button secondary" disabled={pending} onClick={()=>refresh(state.nextCursor!)}>Consultas anteriores</button>}
 </section>;
}
