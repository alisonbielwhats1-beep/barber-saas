import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { definition,hqTimezone,money,type Row } from "@/lib/hq/catalog";
import { today } from "@/lib/hq/validation";
export function displayDate(value:unknown,withTime=false){if(!value)return "—";const d=new Date(String(value));if(Number.isNaN(d.getTime()))return "—";return formatInTimeZone(d,String(value).length===10?"UTC":hqTimezone,withTime?"dd/MM/yyyy HH:mm":"dd/MM/yyyy");}
export function Badge({value}:{value:unknown}){const s=String(value??"—");return <span className="hq-badge" data-tone={["Ativo","Pago","Fechado","Concluído","Resolvido","Em dia"].includes(s)?"good":["Inadimplente","Atrasado","Crítica","Quente","Alto"].includes(s)?"bad":["Teste","Morno","Pendente","Alta"].includes(s)?"warn":""}>{s}</span>;}
export function Heading({title,description,children}:{title:string;description:string;children?:React.ReactNode}){return <div className="hq-heading"><div><p className="hq-eyebrow">Everflare HQ · Operação interna</p><h1>{title}</h1><p>{description}</p></div>{children}</div>;}
export function Tabs({links,current}:{links:[string,string][];current?:string}){return <div className="hq-tabs">{links.map(([href,label])=><Link key={href} href={href} aria-current={current===href?"page":undefined}>{label}</Link>)}</div>;}
export function Timeline({rows}:{rows:Row[]}){return rows.length?<ol className="hq-timeline">{rows.map(r=><li key={r.id}><small>{displayDate(r.createdAt,true)} · {r.kind}</small><p>{r.description}</p></li>)}</ol>:<p>Nenhuma atividade registrada.</p>;}
export function DataTable({entity,rows,options={}}:{entity:string;rows:Row[];options?:Record<string,{id:string;label:string}[]>}) {
 if(!rows.length)return <div className="hq-empty"><h3>Nenhum registro encontrado</h3><p>Cadastre o primeiro registro ou ajuste os filtros.</p></div>;
 const def=definition(entity);
 const preferred:Record<string,string[]>={subscriptions:["customerId","plan","amountCents","discountCents","interval","nextBillingAt","status","trialEnd"],payments:["subscriptionId","reference","dueDate","amountCents","status","paidDate","method"],tickets:["customerId","title","category","priority","status","owner"],bugs:["title","priority","status","version","resolvedAt"],features:["title","category","status","priority"],followups:["accountId","title","dueAt","status","owner"]};
 const columns=preferred[entity]?preferred[entity].map(k=>def.fields.find(f=>f.key===k)!):def.fields.filter(f=>!f.readonly&&f.type!=="textarea").slice(0,6);
 if(entity==="payments") rows=rows.map(r=>r.status==="Pendente"&&String(r.dueDate)<today()?{...r,status:"Atrasado"}:r);
 return <div className="hq-table-wrap"><table><thead><tr><th>Registro</th>{columns.map(f=><th key={f.key}>{f.label}</th>)}<th>Entrada</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><Link href={"/hq/"+entity+"/"+r.id}>{String(r.title??r.name??def.singular)} ↗</Link></td>{columns.map(f=><td key={f.key}>{f.ref?options[f.ref]?.find(o=>o.id===r[f.key])?.label??"—":f.type==="money"?money(Number(r[f.key])):["date","datetime","month"].includes(f.type)?displayDate(r[f.key],f.type==="datetime"):f.type==="select"?<Badge value={r[f.key]}/>:String(r[f.key]??"—")}</td>)}<td>{displayDate(r.createdAt)}</td></tr>)}</tbody></table></div>;
}
