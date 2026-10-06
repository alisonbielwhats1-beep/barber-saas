/** New T21 oracle. Never included in interpreter context. Historical x41–x49 are untouched. */
import { intent, plan } from "../../../src/test/secretary-capability-plan";
import { call } from "../../../src/test/scripted-services-model";
import { benchmarkFixture, type BenchmarkCase } from "./multi-action-benchmark-cases";
export type T21Case=BenchmarkCase&{checkpoints:("SERVICE"|"DECISION"|"REASON"|"ALTERNATIVES"|"PROPOSAL"|"HARD_BLOCK")[];closure?:boolean};
const pair=(service=true)=>[
  intent("appointment.cancel",{item_key:"a",customer_name:"Amanda Souza",day_offset:1,time:"10:00",reason:"pedido dela"}),
  intent("appointment.create",{item_key:"b",depends_on:["a"],released_slot_of:"a",customer_name:"Fábio Santos",...(service?{service_name:"Corte Completo"}:{})}),
];
const message=()=>intent("customer.message",{item_key:"c",depends_on:["a"],communication:{recipient_name:"Amanda Souza",channel:"WHATSAPP",message_mode:"EXACT",content:"Seu horário foi cancelado."}});
const selection=(ops:ReturnType<typeof intent>[])=>({...plan(ops),independent:false});
const base="Cancela Amanda Souza amanhã às 10h por pedido dela e coloca Fábio Santos no lugar";
const exact='Avisa Amanda Souza no WhatsApp exatamente "Seu horário foi cancelado."';
export const t21Cases:T21Case[]=[
  {id:"x90",actions:2,primary:true,fixture:"amanda_target",messages:[`${base} para Corte Completo.`],expected:selection(pair()),outputs:[],missing:{},final:"PROPOSAL",checkpoints:["PROPOSAL"]},
  {id:"x91",actions:5,primary:false,fixture:"amanda_target",overlap:true,
    messages:[`${base}. ${exact} Altera a Massagem para R$80 e me fala quanto faturei ontem.`,"Corte Completo.","Pode encaixar.","Cliente já está aguardando."],
    expected:selection([...pair(false),message(),intent("service.change",{item_key:"d",target_name:"Massagem",priceCents:8000}),intent("financial.report",{item_key:"e",financial:{metrics:["service_revenue"],period:"yesterday"}})]),
    outputs:[call("upsert_action_draft",{item_key:"b",service_name:"Corte Completo"}),call("upsert_action_draft",{item_key:"b",override_requested:true}),call("upsert_action_draft",{item_key:"b",override_reason:"Cliente já está aguardando"})],
    missing:{b:["service_name"]},final:"PROPOSAL",checkpoints:["SERVICE","DECISION","REASON","PROPOSAL"]},
  {id:"x92",actions:3,primary:false,fixture:"amanda_target",overlap:true,messages:[`${base} para Corte Completo. ${exact}`,"Outro horário.","11h."],
    expected:selection([...pair(),message()]),outputs:[call("upsert_action_draft",{item_key:"b",destination_mode:"ALTERNATIVE_SLOT",override_requested:false}),call("upsert_action_draft",{item_key:"b",time:"11:00"})],
    missing:{},final:"PROPOSAL",checkpoints:["DECISION","ALTERNATIVES","PROPOSAL"]},
  {id:"x93",actions:2,primary:false,fixture:"amanda_target",overlap:true,messages:[`${base} para Corte Completo, mesmo que dê conflito, porque ele já está aguardando.`],
    expected:selection([pair()[0],intent("appointment.create",{item_key:"b",depends_on:["a"],released_slot_of:"a",customer_name:"Fábio Santos",service_name:"Corte Completo",override_requested:true,override_reason:"ele já está aguardando"})]),
    outputs:[],missing:{},final:"PROPOSAL",checkpoints:["PROPOSAL"]},
  {id:"x94",actions:2,primary:false,fixture:"amanda_target",overlap:true,closure:true,messages:[`${base} para Corte Completo, mesmo que dê conflito, porque ele já está aguardando.`],
    expected:selection([pair()[0],intent("appointment.create",{item_key:"b",depends_on:["a"],released_slot_of:"a",customer_name:"Fábio Santos",service_name:"Corte Completo",override_requested:true,override_reason:"ele já está aguardando"})]),
    outputs:[],missing:{},final:"CONFLICT",checkpoints:["HARD_BLOCK"]},
];
export const t21Fixture=(c:BenchmarkCase,_phase?:"a"|"b")=>{void _phase;return benchmarkFixture(c,"b");};
export const T21_MAX_REQUESTS=10;
export const T21_MAX_USD=.13;
