import Link from "next/link";
import { withHq } from "@/lib/hq/access";
import { knowledgeArticles,knowledgeVersion } from "@/lib/hq/knowledge";
export default async function KnowledgePage(){
 await withHq(async()=>undefined);
 return <><div className="hq-heading"><div><h1>Base de conhecimento</h1><p>Orientações usadas para preparar os rascunhos de suporte.</p></div><Link href="/hq/agents/support">Abrir Suporte assistido</Link></div>
 <p>Revisão técnica: 11/09/2026 · Versão {knowledgeVersion}. Conteúdo versionado com o produto; alterações passam por revisão. Condições comerciais precisam da sua confirmação.</p>
 <nav className="hq-actions" aria-label="Assuntos da base">{knowledgeArticles.map(a=><a href={"#"+a.id} key={a.id}>{a.title}</a>)}</nav>
 <div className="hq-knowledge">{knowledgeArticles.map(a=><article className="hq-panel" id={a.id} key={a.id}><h2>{a.title}</h2>{a.humanOnly&&<p className="hq-agent-pill">Revisão humana obrigatória</p>}<p>{a.body}</p><details><summary>Fonte da orientação</summary><p>{a.source} · {knowledgeVersion}</p></details></article>)}</div></>;
}
