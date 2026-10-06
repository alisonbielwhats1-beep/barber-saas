/** Faithful materialization of the dated Golden table; historical text is never edited. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fixtureSchema, suiteSchema, type FreeUseSuite } from './free-use-contract';
const ref = (kind: string, key: string) => '$ref:' + kind + ':' + key;
export const goldenFixture = fixtureSchema.parse({
  customers: [{key:'lara',name:'Lara Matos',phone:'11990001001',email:'lara.original@example.invalid'},
    {key:'bruno',name:'Bruno Leal',phone:'11990001002'}, {key:'celia',name:'Célia Prado',phone:'11990001003'},
    {key:'marina_a',name:'Marina Costa',phone:'11990001004'}, {key:'marina_b',name:'Marina Costa',phone:'11990001005'}],
  professionals: [{key:'nina',name:'Nina'}],
  services: [{key:'escova',name:'Escova Lisa',durationMin:45,priceCents:5500,professionalKeys:['nina']},
    {key:'hidratacao',name:'Hidratação Névoa',durationMin:30,priceCents:7200,professionalKeys:['nina']},
    {key:'corte_curto',name:'Corte Curto',durationMin:30,priceCents:4800,professionalKeys:['nina']},
    {key:'corte_longo',name:'Corte Longo',durationMin:60,priceCents:8500,professionalKeys:['nina']}],
  products: [{key:'oleo',name:'Óleo Aurora',stock:8,minStock:1}],
  appointments: [{key:'bruno_terca',customerKey:'bruno',professionalKey:'nina',serviceKey:'hidratacao',startAt:'2027-04-13T10:00:00-03:00'},
    {key:'lara_terca',customerKey:'lara',professionalKey:'nina',serviceKey:'escova',startAt:'2027-04-13T14:00:00-03:00'},
    {key:'celia_quarta',customerKey:'celia',professionalKey:'nina',serviceKey:'escova',startAt:'2027-04-14T15:00:00-03:00'},
    {key:'finance_last_week',customerKey:'bruno',professionalKey:'nina',serviceKey:'corte_longo',startAt:'2027-04-09T10:00:00-03:00',status:'COMPLETED',payment:{amountCents:8500,paidAt:'2027-04-09T11:00:00-03:00'}}],
  openWeekdays:[1,2,3,4,5],openMinutes:540,closeMinutes:1080,
  closures:[{startAt:'2027-04-18T00:00:00-03:00',endAt:'2027-04-19T00:00:00-03:00',reason:'Domingo fechado na fixture congelada'}],
});
const one = (operation: string, effective: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({actionCount:1,confirmable:true,actions:[{operation,effective,proposal:true,...extra}]});
const waiting = (operation: string, fields: string[], effective: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({actionCount:1,confirmable:false,actions:[{operation,effective,proposal:false,missingAll:fields,missingOnly:fields,...extra}]});
const read = (operation: string, effective: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({actionCount:1,confirmable:false,actions:[{operation,effective,proposal:false,statusAny:["DONE"],resultRequired:true,...extra}]});
const createAt = (customer: string, service: string, date: string, time: string, duration: number) => one('appointment.create',
  {customer_ref:ref('customer',customer),service_ref:ref('service',service),professional_ref:ref('professional','nina'),date,time},
  {proposalFields:{'snapshot.durationMin':duration,'snapshot.date':date,'snapshot.startLocal':date+'T'+time,'snapshot.customer_ref':ref('customer',customer)}});
const move = (date: string, time: string, extra: Record<string, unknown> = {}) => one('appointment.change',
  {appointment_ref:ref('appointment','lara_terca'),date,time,source_time:'14:00'},extra);
const unsupported = {actionCount:0,confirmable:false,capabilityStatus:'UNSUPPORTED'};
const oracle: Record<string, { expect: unknown; when?: {missingAny:string[]} }[]> = {
  GF01:[{expect:one('service.create',{name:'Brilho de Seda',priceCents:6400,durationMin:40})}],
  GF02:[{expect:waiting('service.create',['durationMin'],{name:'Ritual de Argila',priceCents:9600})},
    {when:{missingAny:['durationMin']},expect:one('service.create',{name:'Ritual de Argila',priceCents:9600,durationMin:50},{sameDraft:true,preserve:['name','priceCents']})}],
  GF03:[{expect:one('customer.create',{name:'Joana Torres'},{forbiddenEffective:['phone','email']})}],
  GF04:[{expect:one('customer.change',{email:'lara.teste@example.invalid'},{proposalFields:{'change.customer_ref':ref('customer','lara')}})}],
  GF05:[{expect:read('customer.read',{}, {resultContains:{id:ref('customer','celia'),name:'Célia Prado'}})}],
  GF06:[{expect:one('service.change',{name:'Hidratação Névoa',priceCents:7600,durationMin:30},{proposalFields:{'change.service_ref':ref('service','hidratacao')}})}],
  GF07:[{expect:one('service.change',{name:'Escova Lisa',priceCents:6500,durationMin:45})},
    {expect:one('service.change',{name:'Escova Lisa',priceCents:6700,durationMin:45},{sameDraft:true,changedApproval:true,preserve:['name','durationMin']})}],
  GF08:[{expect:createAt('lara','hidratacao','2027-04-13','16:00',30)}],
  GF09:[{expect:waiting('appointment.create',['time'],{date:'2027-04-14',customer_ref:ref('customer','celia'),service_ref:ref('service','escova')})},
    {when:{missingAny:['time']},expect:{...createAt('celia','escova','2027-04-14','10:45',45),actions:[{...createAt('celia','escova','2027-04-14','10:45',45).actions[0],sameDraft:true,preserve:['date','customer_ref','service_ref']}]}}],
  GF10:[{expect:{actionCount:1,confirmable:false,actions:[{operation:'appointment.create',effective:{date:'2027-04-15',time:'11:00',customer_ref:ref('customer','bruno')},candidateKind:'service_ref',missingAny:['service_ref'],proposal:false}]}},
    {when:{missingAny:['service_ref']},expect:createAt('bruno','corte_longo','2027-04-15','11:00',60)}],
  GF11:[{expect:{...move('2027-04-14','16:00'),allowSafeClarification:true,actions:[{operation:'appointment.change',fields:{customer_name:'Lara Matos'},effective:{date:'2027-04-14',time:'16:00',source_date:'2027-04-13',source_time:'14:00'},allowMissing:['time','source_time'],missingOnly:['time','source_time'],proposal:true,proposalFields:{'action_snapshot.appointment_ref':ref('appointment','lara_terca'),'action_snapshot.startLocal':'2027-04-14T16:00','action_snapshot.before_start':'2027-04-13T14:00'}}]}}],
  GF12:[{expect:move('2027-04-14','16:00',{effective:{appointment_ref:ref('appointment','lara_terca'),source_date:'2027-04-13',source_time:'14:00',date:'2027-04-14',time:'16:00'}})}],
  GF13:[{expect:{actionCount:1,confirmable:false,actions:[{operation:'appointment.change',effective:{date:'2027-04-15',time:'16:00'},missingAny:['appointment_ref','source_time'],proposal:false}]}},
    {when:{missingAny:['appointment_ref','source_time']},expect:move('2027-04-15','16:00',{sameDraft:true,preserve:['date','time']})}],
  GF14:[{expect:waiting('appointment.change',['time'],{source_date:'2027-04-14',source_time:'15:00',date:'2027-04-16',appointment_ref:ref('appointment','celia_quarta')})},
    {when:{missingAny:['time']},expect:one('appointment.change',{source_date:'2027-04-14',source_time:'15:00',date:'2027-04-16',time:'17:15',appointment_ref:ref('appointment','celia_quarta')},{sameDraft:true,preserve:['source_date','source_time','appointment_ref','date']})}],
  GF15:[{expect:{actionCount:1,confirmable:false,actions:[{operation:'appointment.change',effective:{date:'2027-04-14',time:'16:00',source_time:'13:00'},forbiddenEffective:['appointment_ref'],proposal:false}]}},
    {expect:move('2027-04-14','16:00',{sameDraft:true,preserve:['date','time']})}],
  GF16:[{expect:move('2027-04-14','16:00')},{expect:move('2027-04-15','16:00',{sameDraft:true,changedApproval:true,preserve:['source_time','appointment_ref','time']})}],
  GF17:[{expect:one('appointment.cancel',{appointment_ref:ref('appointment','bruno_terca'),date:'2027-04-13',time:'10:00'},{sourceBackedEffective:['reason']})}],
  GF18:[{expect:waiting('appointment.cancel',['reason'],{appointment_ref:ref('appointment','celia_quarta'),date:'2027-04-14',time:'15:00'},{forbiddenEffective:['reason']})},
    {when:{missingAny:['reason']},expect:one('appointment.cancel',{appointment_ref:ref('appointment','celia_quarta'),date:'2027-04-14',time:'15:00'},{sameDraft:true,sourceBackedEffective:['reason'],preserve:['appointment_ref','date','time']})}],
  GF19:[{expect:{...read('appointment.read'),forbidOperations:['appointment.cancel'],actions:[{operation:'appointment.read',statusAny:['DONE'],resultRequired:true,resultContains:{appointment_ref:ref('appointment','bruno_terca')},proposal:false}]}}],
  GF20:[{expect:read('appointment.list',{date:'2027-04-13',period:'morning',professional_ref:ref('professional','nina')},{resultContains:{appointment_ref:ref('appointment','bruno_terca')}})}],
  GF21:[{expect:read('availability.get',{date:'2027-04-14',period:'afternoon',service_ref:ref('service','escova'),professional_ref:ref('professional','nina')},{forbiddenEffective:['time'],availability:{date:'2027-04-14',durationMin:45,professionalRef:ref('professional','nina'),startMinute:720,endMinute:1080,minResults:1,excluded:[{startMinute:900,endMinute:945}]}})}],
  GF22:[{expect:{actionCount:1,confirmable:false,actions:[{operation:'appointment.create',effective:{date:'2027-04-13',time:'10:15'},reviewStatus:'CONFLICT_OVERRIDABLE',proposal:false}]}},
    {expect:{actionCount:1,confirmable:false,actions:[{operation:'appointment.create',effective:{date:'2027-04-13',time:'10:15',override_requested:true},missingAny:['override_reason'],proposal:false}]}},
    {when:{missingAny:['override_reason']},expect:createAt('celia','hidratacao','2027-04-13','10:15',30)}],
  GF23:[{expect:{actionCount:1,confirmable:false,actions:[{operation:'appointment.create',effective:{date:'2027-04-18',time:'10:00'},reviewStatus:'CONFLICT_HARD_BLOCK',reviewCause:'SALON_CLOSED',proposal:false}]}},
    {expect:{actionCount:1,confirmable:false,actions:[{operation:'appointment.create',effective:{date:'2027-04-18',time:'10:00'},reviewStatus:'CONFLICT_HARD_BLOCK',reviewCause:'SALON_CLOSED',proposal:false}]}}],
  GF24:[{expect:{actionCount:1,confirmable:false,actions:[{operation:'appointment.create',missingAny:['date'],proposal:false}]}}],
  GF25:[{expect:createAt('celia','hidratacao','2027-04-14','11:30',30)}],
  GF26:[{expect:createAt('lara','hidratacao','2027-04-13','16:00',30)}],
  GF27:[{expect:one('stock.movement',{mode:'OUT',quantity:3,product_ref:ref('product','oleo')},{sourceBackedEffective:['reason'],proposalFields:{'product.stock':8,projected_stock:5,delta:-3}})}],
  GF28:[{expect:waiting('stock.movement',['quantity'],{mode:'IN',product_ref:ref('product','oleo')},{forbiddenEffective:['quantity']})},
    {when:{missingAny:['quantity']},expect:one('stock.movement',{mode:'IN',quantity:12,product_ref:ref('product','oleo')},{sameDraft:true,preserve:['mode','product_ref'],proposalFields:{'product.stock':8,projected_stock:20,delta:12}})}],
  GF29:[{expect:{actionCount:3,actions:[{operation:'service.create',effective:{name:'Toque de Luz',priceCents:4200,durationMin:25},proposal:true},
    {operation:'stock.movement',effective:{mode:'IN',quantity:4,product_ref:ref('product','oleo')},proposal:true,proposalFields:{projected_stock:12}},
    {operation:'financial.report',statusAny:['DONE'],resultRequired:true,fields:{'financial.metrics':['received_revenue'],'financial.period':'last_week'},proposal:false,resultContains:{id:'received_revenue',value:8500}}]}}],
  GF30:[{expect:unsupported},{expect:unsupported}],
};
export function goldenSuite(documentPath = 'docs/SECRETARY_GOLDEN_FREE_USE_30.md'): FreeUseSuite {
  const bytes = readFileSync(documentPath), text = bytes.toString('utf8');
  const cases = text.split(/\r?\n/).filter(line => /^\| GF\d{2} /.test(line)).map(line => {
    const cells = line.split('|').map(cell => cell.trim()), header = cells[1];
    const id = header.slice(0,4), family = header.slice(5), messages = [...cells[2].matchAll(/“([^”]+)”/g)].map(match => match[1]);
    if (!oracle[id] || messages.length !== oracle[id].length) throw Error('FREE_USE_GOLDEN_SOURCE_SHAPE');
    const fixture = id === 'GF13' ? fixtureSchema.parse({...goldenFixture,appointments:[...goldenFixture.appointments,
      {key:'lara_quarta',customerKey:'lara',professionalKey:'nina',serviceKey:'hidratacao',startAt:'2027-04-14T11:00:00-03:00'}]}) : undefined;
    return {id,family,criterion:cells[3],...(fixture?{fixture}:{}),...(id==='GF26'?{clock:'2027-04-13T01:30:00Z'}:{}),
      requireOverlap:id==='GF22',turns:messages.map((message,index)=>({message,...oracle[id][index]}))};
  });
  if(cases.length!==30)throw Error('FREE_USE_GOLDEN_CASE_COUNT');
  return suiteSchema.parse({schemaVersion:1,suiteId:'golden-free-use-30',timezone:'America/Sao_Paulo',clock:'2027-04-12T12:00:00Z',
    source:{path:documentPath,sha256:createHash('sha256').update(bytes).digest('hex')},fixture:goldenFixture,cases});
}
