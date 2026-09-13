"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { definition, hqTimezone, type Field, type Row } from "@/lib/hq/catalog";
import { hqCommand } from "@/app/hq/actions";
import { today, normalizedTitle } from "@/lib/hq/validation";
import type { Command } from "@/lib/hq/services";
export type Options = Record<string, { id: string; label: string }[]>;
function defaultValue(field: Field, record?: Row | null) {
 const v=record?.[field.key];
 if(v===null||v===undefined) return field.type==="money"?"0":field.options?.[0]??(field.default!==undefined?String(field.default):"");
 if(field.type==="money") return (Number(v)/100).toFixed(2);
 if(field.type==="datetime") return formatInTimeZone(new Date(String(v)),hqTimezone,"yyyy-MM-dd'T'HH:mm");
 if(field.type==="date") return String(v).slice(0,10);
 if(field.type==="month") return String(v).slice(0,7);
 return String(v);
}
function FormField({field, record, options, prefix=""}:{field:Field;record?:Row|null;options:Options;prefix?:string}) {
 const name=prefix+field.key;const value=defaultValue(field,record);
 const choices=field.options?.filter(o=>!(field.key==="status"&&((o==="Convertido"&&value!=="Convertido")||(o==="Pago"&&value!=="Pago"))));
 return <label className={field.type==="textarea"?"wide":undefined} htmlFor={name}>{field.label}{field.required?" *":""}
 {field.ref||choices?<select id={name} name={name} defaultValue={value} required={field.required}><option value="">Selecionar</option>{field.ref?(options[field.ref]??[]).map(o=><option key={o.id} value={o.id}>{o.label}</option>):choices?.map(o=><option key={o} value={o}>{o}</option>)}</select>
 :field.type==="textarea"?<textarea id={name} name={name} defaultValue={value} maxLength={10000} required={field.required}/>
 :<input id={name} name={name} type={field.type==="money"||field.type==="number"?"number":field.type==="datetime"?"datetime-local":["email","date","month"].includes(field.type)?field.type:"text"} defaultValue={value} min={field.type==="money"||field.type==="number"?0:undefined} max={field.max} step={field.type==="money"?"0.01":undefined} maxLength={300} required={field.required}/>}
 </label>;
}
export function Editor({entity,record,account,options,initial={}}:{entity:string;record?:Row|null;account?:Row|null;options:Options;initial?:Record<string,string>}) {
 const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[success,setSuccess]=useState(false);const[reviewed,setReviewed]=useState(false);const[title,setTitle]=useState("");const alert=useRef<HTMLDivElement>(null);
 const def=definition(entity);const isAccount=entity==="leads"||entity==="customers";const initialRecord=record??({...initial} as Row);
 const similar=entity==="features"&&title.length>2?(options.features??[]).filter(o=>o.id!==record?.id&&normalizedTitle(o.label).split(" ").some(w=>w.length>3&&normalizedTitle(title).includes(w))):[];
 if (record?.billingSubscriptionId || record?.billingChargeId) return <p className="hq-panel">Dados financeiros sincronizados automaticamente pelo Mercado Pago. As alterações aparecem após a confirmação do provedor.</p>;
 async function submit(event:React.FormEvent<HTMLFormElement>) {
 event.preventDefault();if(busy)return;setError("");setSuccess(false);const form=new FormData(event.currentTarget);
 const read=(fields:readonly Field[],prefix="")=>Object.fromEntries(fields.filter(f=>!f.readonly).map(f=>[f.key,f.type==="money"?Math.round(Number(form.get(prefix+f.key))*100):form.get(prefix+f.key)??""]));
 const values=read(def.fields);if(isAccount)values.accountId=record?.accountId??"00000000-0000-4000-8000-000000000000";setBusy(true);
 try{const result=await hqCommand({type:"save",entity,id:record?.id,values,account:isAccount?read(definition("accounts").fields,"account."):undefined});
 if(!result.ok){setError(result.error);setTimeout(()=>alert.current?.focus(),0);}else{setSuccess(true);router.refresh();if(!record)router.push("/hq/"+entity+"/"+result.id);}
 }catch{setError("Não foi possível salvar. Atualize a página para verificar sua sessão.");}finally{setBusy(false);}
 }
 return <form onSubmit={submit} onChange={e=>{if(entity==="features"&&(e.target as HTMLInputElement).name==="title"){setTitle((e.target as HTMLInputElement).value);setReviewed(false);}}}>
 {error&&<div className="hq-error" role="alert" tabIndex={-1} ref={alert}>{error}</div>}{success&&<p role="status" className="hq-success">Registro salvo.</p>}
 <div className="hq-form-grid">{isAccount&&<><h3 className="hq-form-title">Dados de contato</h3>{definition("accounts").fields.map(f=><FormField key={f.key} field={f} record={account} options={options} prefix="account."/>) }<h3 className="hq-form-title">Informações comerciais</h3></>}{def.fields.filter(f=>!f.readonly&&!(isAccount&&f.key==="accountId")).map(f=>entity==="customers"&&account?.billingSalonId&&["status","startedAt","paymentMethod"].includes(f.key)?<fieldset key={f.key} disabled><FormField field={f} record={initialRecord} options={options}/><small>Sincronizado pelo Mercado Pago</small></fieldset>:<FormField key={f.key} field={f} record={initialRecord} options={options}/>)}</div>
 {entity==="features"&&!record&&<div className="hq-panel"><h3>Revisar solicitações existentes</h3><p>Associe o cliente a uma feature existente quando já representar a mesma necessidade.</p>{similar.length?similar.map(f=><p key={f.id}><a href={"/hq/features/"+f.id}>{f.label}</a></p>):<p>Nenhum título próximo identificado nesta busca por palavras.</p>}<label style={{display:"flex",alignItems:"center"}}><input type="checkbox" style={{width:20}} checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>Revisei os títulos e esta é uma solicitação diferente.</label></div>}
 <p><small>Valores em reais. Datas e horários em Brasília (America/Sao_Paulo).</small></p><button className="hq-button" type="submit" disabled={busy||(entity==="features"&&!record&&!reviewed)}>{busy?"Salvando…":"Salvar "+def.singular.toLowerCase()}</button></form>;
}
export function CommandButton({command,children}:{command:Command;children:React.ReactNode}) {
 const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState("");
 return <div><button className="hq-button secondary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{const r=await hqCommand(command);if(!r.ok)setError(r.error);else router.refresh();}catch{setError("Não foi possível executar. Atualize a página e tente novamente.");}finally{setBusy(false);}}}>{busy?"Processando…":children}</button>{error&&<p role="alert" className="hq-error">{error}</p>}</div>;
}
export function ConfirmPayment({record}:{record:Row}) {
 const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState("");
 if (record.billingChargeId) return <p>Confirmação automática pelo Mercado Pago.</p>;
 return <details className="hq-panel"><summary>Confirmar pagamento</summary><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");try{const result=await hqCommand({type:"pay",id:record.id,paidDate:String(f.get("paidDate")),method:String(f.get("method"))});if(!result.ok)setError(result.error);else router.refresh();}catch{setError("Falha ao confirmar. Atualize para conferir o recebimento.");}finally{setBusy(false);}}}><div className="hq-form-grid"><label>Data do pagamento<input name="paidDate" type="date" defaultValue={today()} max={today()} required/></label><label>Método<input name="method" defaultValue={String(record.method??"PIX")} required maxLength={100}/></label></div>{error&&<p role="alert" className="hq-error">{error}</p>}<button className="hq-button" disabled={busy}>Confirmar pagamento</button></form></details>;
}
export function FeedbackConvert({record,options}:{record:Row;options:Options}) {
 const[target,setTarget]=useState<"tickets"|"bugs"|"features">("tickets");const[id,setId]=useState("");
 return <section className="hq-panel"><h2>Transformar feedback</h2><p>Revise os itens de produto existentes antes de relacionar esta solicitação.</p><div className="hq-form-grid"><label>Destino<select value={target} onChange={e=>{setTarget(e.target.value as typeof target);setId("");}}><option value="tickets">Novo ticket</option><option value="bugs">Bug existente</option><option value="features">Feature existente</option></select></label>{target!=="tickets"&&<label>Item<select value={id} onChange={e=>setId(e.target.value)}><option value="">Selecionar</option>{options[target]?.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}</div>{target!=="tickets"&&<p><a href={"/hq/"+target+"/new"}>Cadastrar um novo item após revisão</a></p>}{(target==="tickets"||id)&&<CommandButton command={{type:"feedback",id:record.id,target,existingId:id||undefined}}>Relacionar feedback</CommandButton>}</section>;
}

