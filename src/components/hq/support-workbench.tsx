"use client";
import Link from "next/link";
import { useRef,useState } from "react";
import { askSupportAction,supportStateAction,reviewSupportAction,supportItemsAction } from "@/app/hq/agents/support/actions";
import type { SupportState,SupportRun } from "@/lib/hq/support-contract";
const money=(micros:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"USD",minimumFractionDigits:4}).format(micros/1e6);
const date=(value:string)=>new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date(value));
export function SupportWorkbench({initial}:{initial:SupportState}){
 const [state,setState]=useState(initial),[query,setQuery]=useState(""),[question,setQuestion]=useState(""),[pending,setPending]=useState(false),[error,setError]=useState("");
 const busy=useRef(false),attempt=useRef<{id:string;customerId:string;question:string}|null>(null);
 async function load(customerId?:string,cursor?:string){
  if(busy.current)return;busy.current=true;setPending(true);setError("");
  try{setState(await supportStateAction(customerId,query,cursor));}catch{setError("Não foi possível carregar. Confira sua sessão e conexão.");}finally{busy.current=false;setPending(false);}
 }
 async function generate(){
  if(busy.current||!state.customerId||!state.ready)return;busy.current=true;setPending(true);setError("");
  const clean=question.trim();
  if(attempt.current?.question!==clean||attempt.current?.customerId!==state.customerId)attempt.current={id:crypto.randomUUID(),customerId:state.customerId,question:clean};
  try{const result=await askSupportAction(attempt.current);if(!result.ok){setError(result.error);return;}const next=await supportStateAction(state.customerId,query);setState(next);if(next.runs.some(r=>r.id===result.id&&r.status!=="running"))attempt.current=null;}
  catch{setError("Conexão interrompida. Atualize o histórico; reenviar a mesma dúvida reutiliza a solicitação.");}finally{busy.current=false;setPending(false);}
 }
 return <section className="hq-panel hq-chief" aria-label="Atendimento assistido">
 <p>Selecione o cliente antes de informar a dúvida. O texto e um contexto limitado do HQ serão enviados à OpenAI. Não inclua senhas, dados de cartão ou dados pessoais dos clientes do salão.</p>
 <form className="hq-actions" onSubmit={e=>{e.preventDefault();void load(state.customerId??undefined);}}><label>Buscar estabelecimento<input value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} disabled={pending}/></label><button className="hq-button secondary" disabled={pending}>Buscar clientes</button></form>
 <label>Cliente do Everflare<select value={state.customerId??""} disabled={pending} onChange={e=>{attempt.current=null;setQuestion("");void load(e.target.value||undefined);}}><option value="">Selecione um cliente</option>{state.context&&state.customerId&&!state.customers.some(c=>c.id===state.customerId)&&<option value={state.customerId}>{state.context.business}</option>}{state.customers.map(c=><option value={c.id} key={c.id}>{c.business}</option>)}</select></label>
 {state.customersLimited&&<p>Exibindo até 50 clientes. Refine a busca pelo estabelecimento.</p>}
 {state.customers.length===0&&<p>Nenhum cliente encontrado. <Link href="/hq/customers">Consultar cadastros</Link></p>}
 {state.context&&<p><strong>{state.context.business}</strong> · {state.context.status} · {state.context.tickets} tickets · {state.context.activities} atividades. <Link href={"/hq/customers/"+state.customerId}>Perfil completo</Link></p>}
 {!state.ready&&<p role="status">{state.reason}</p>}
 <form onSubmit={e=>{e.preventDefault();void generate();}}><label htmlFor="support-question">Dúvida do cliente</label><textarea id="support-question" rows={4} minLength={3} maxLength={1000} required value={question} onChange={e=>setQuestion(e.target.value)} disabled={pending||!state.ready||!state.customerId}/><button className="hq-button" disabled={pending||!state.ready||!state.customerId||question.trim().length<3}>{pending?"Aguarde…":"Gerar rascunho de suporte"}</button></form>
 <p>Orçamento compartilhado com o Chefe: {money(state.budgetMicros)}/mês · estimado e reservado: {money(state.committedMicros)}. Até 20 consultas/dia UTC entre os dois agentes.</p>
 <p role="alert">{error}</p><div className="hq-actions"><h2>Rascunhos e revisões</h2><button className="hq-button secondary" disabled={pending} onClick={()=>load(state.customerId??undefined)}>Atualizar rascunhos</button></div>
 {!state.customerId?<p>Selecione uma conta para consultar seu histórico.</p>:state.runs.length===0?<p>Nenhum rascunho nesta página.</p>:state.runs.map(run=><SupportReviewCard key={run.id} run={run} customerId={state.customerId!} disabled={pending} refresh={()=>load(state.customerId??undefined)}/>)}
 {state.nextCursor&&<button className="hq-button secondary" disabled={pending} onClick={()=>load(state.customerId!,state.nextCursor!)}>Rascunhos anteriores</button>}
 </section>;
}
function SupportReviewCard({run,customerId,disabled,refresh}:{run:SupportRun;customerId:string;disabled:boolean;refresh:()=>Promise<void>}){
 const draft=run.draft;
 const [text,setText]=useState(draft?.reply??""),[title,setTitle]=useState(draft?.title??""),[category,setCategory]=useState(draft?.category??"Suporte"),[priority,setPriority]=useState("Média"),[decision,setDecision]=useState("reply"),[existingId,setExistingId]=useState(""),[search,setSearch]=useState(""),[items,setItems]=useState<{id:string;title:string;status:string}[]>([]),[notice,setNotice]=useState(""),[pending,setPending]=useState(false),[review,setReview]=useState(run.review);
 const busy=useRef(false);
 async function findItems(){if(busy.current||!(decision==="bug"||decision==="feature"))return;busy.current=true;setPending(true);setNotice("");try{const result=await supportItemsAction(decision,search);setItems(result.items);setExistingId("");setNotice(result.hasMore?"Exibindo 50 itens. Refine a busca.":result.items.length?"Confira título e status antes de associar.":"Nenhum item encontrado. Revise ou crie o item no Produto e busque novamente.");}catch{setNotice("Não foi possível buscar itens.");}finally{busy.current=false;setPending(false);}}
 async function approve(){if(busy.current)return;busy.current=true;setPending(true);setNotice("");try{const result=await reviewSupportAction({runId:run.id,customerId,decision,text,title,category,priority,...(existingId?{existingId}:{})});if(!result.ok){setNotice(result.error);return;}setReview(result.review);await refresh();}catch{setNotice("Não foi possível confirmar. Atualize o histórico antes de repetir.");}finally{busy.current=false;setPending(false);}}
 return <article className="hq-support-draft"><h3>{run.question}</h3><p>{date(run.createdAt)} · {run.status==="completed"?"Rascunho gerado":run.status==="running"?"Em andamento":"Geração não concluída"} · {money(run.chargeMicros)} {run.status==="completed"?"estimados":"reservados"}</p>
 {run.status==="failed"&&<p>A reserva foi mantida. Confira o consumo antes de gerar outra solicitação.</p>}
 {draft&&<><p><strong>{draft.needsHuman?"Precisa de atendimento humano":"Aguardando sua revisão"}</strong> · {draft.reason}</p><p className="hq-chief-answer">{draft.reply}</p><nav className="hq-actions" aria-label="Fontes do rascunho">{run.sources.map(s=><Link key={s.href} href={s.href}>{s.label}</Link>)}</nav></>}
 {review?<div role="status"><p>Revisão registrada · {review.decision==="discard"?"Descartado":review.decision==="reply"?"Resposta aprovada para uso manual":"Encaminhamento registrado"}. Nenhuma mensagem enviada.</p><p className="hq-chief-answer">{review.text}</p>{review.targetId&&<Link href={review.targetType==="tickets"?"/hq/support":"/hq/product"}>Consultar encaminhamento</Link>}</div>:draft&&run.status==="completed"&&<details><summary>Revisar e decidir</summary><form onSubmit={e=>{e.preventDefault();void approve();}}>
 <label>Título do atendimento<input value={title} minLength={3} maxLength={120} required disabled={pending||disabled} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Texto revisado<textarea rows={5} value={text} minLength={3} maxLength={4000} required disabled={pending||disabled} onChange={e=>setText(e.target.value)}/></label>
 <label>Decisão<select value={decision} disabled={pending||disabled} onChange={e=>{setDecision(e.target.value);setItems([]);setExistingId("");setNotice("");}}><option value="reply">Aprovar resposta para uso manual</option><option value="ticket">Criar ticket</option><option value="bug">Associar a bug existente</option><option value="feature">Associar a funcionalidade existente</option><option value="discard">Descartar rascunho</option></select></label>
 {decision==="ticket"&&<div className="hq-support-fields"><label>Categoria<select value={category} disabled={pending||disabled} onChange={e=>setCategory(e.target.value as typeof category)}>{["Dúvida","Suporte","Bug","Financeiro","Outro"].map(c=><option key={c}>{c}</option>)}</select></label><label>Prioridade<select value={priority} disabled={pending||disabled} onChange={e=>setPriority(e.target.value)}>{["Baixa","Média","Alta","Crítica"].map(c=><option key={c}>{c}</option>)}</select></label></div>}
 {(decision==="bug"||decision==="feature")&&<><label>Buscar item existente<input value={search} maxLength={100} disabled={pending||disabled} onChange={e=>setSearch(e.target.value)}/></label><div className="hq-actions"><button type="button" className="hq-button secondary" disabled={pending||disabled} onClick={findItems}>Buscar itens</button><Link href="/hq/product" target="_blank" rel="noreferrer">Revisar Produto em outra aba</Link></div><label>Item para associar<select required value={existingId} disabled={pending||disabled} onChange={e=>setExistingId(e.target.value)}><option value="">Selecione após buscar</option>{items.map(item=><option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}</select></label></>}
 <p>Ao confirmar, sua decisão fica registrada no histórico deste cliente. O texto não será enviado. Uma decisão concluída não pode ser substituída.</p><button className="hq-button" disabled={pending||disabled}>{pending?"Registrando…":"Confirmar decisão revisada"}</button>
 </form></details>}
 <p role="alert">{notice}</p></article>;
}
