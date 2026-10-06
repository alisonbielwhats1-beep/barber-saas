import {beforeEach,expect,it,vi} from 'vitest';
const io=vi.hoisted(()=>({customers:vi.fn(),services:vi.fn()}));
vi.mock('../customer-catalog',()=>({searchSalonCustomer:io.customers}));
vi.mock('../scheduling-catalog',()=>({listSchedulingServices:io.services}));
vi.mock('../prisma-tenant',()=>({withTenant:(_actor:unknown,work:(tx:object)=>unknown)=>work({})}));
import {validateSchedulingEntityMentions} from '../scheduling-entity-mentions';
const actor={salonId:'ours',userId:'owner'};
const candidates=[{id:'a',name:'Corte Feminino'},{id:'b',name:'Corte Masculino'}];
beforeEach(()=>{vi.clearAllMocks();io.customers.mockResolvedValue([{id:'c',name:'Ivo Freitas'}]);io.services.mockResolvedValue(candidates);});
it.each(['O masculino.','Prefiro o MASCULINO','Pode ser masculino'])('accepts a distinctive literal in the current backend options: %s',async message=>{
  await expect(validateSchedulingEntityMentions(actor,message,{customer_name:'Ivo Freitas',service_name:'Corte Masculino'},{query:'corte',candidates})).resolves.toBeUndefined();
  expect(io.services).toHaveBeenCalledWith({},actor,'corte');
});
it.each(['O feminino.','Corte.','Masculinou','Tanto faz.'])('does not ground an arbitrary candidate from %s',async message=>{
  await expect(validateSchedulingEntityMentions(actor,message,{customer_name:'Ivo Freitas',service_name:'Corte Masculino'},{query:'corte',candidates})).rejects.toThrow('ENTITY_MENTION_CONFLICT');
});
it('does not use a distinctive service word contained only in the real customer identity',async()=>{
  io.customers.mockResolvedValue([{id:'c',name:'Rui Masculino Silva'}]);
  await expect(validateSchedulingEntityMentions(actor,'Rui Masculino Silva',{customer_name:'Rui',service_name:'Corte Masculino'},{query:'corte',candidates})).rejects.toThrow('ENTITY_MENTION_CONFLICT');
});
it('does not use stale candidates or renamed catalog rows',async()=>{
  io.services.mockResolvedValue([{id:'a',name:'Corte Feminino'},{id:'b',name:'Corte Infantil'}]);
  await expect(validateSchedulingEntityMentions(actor,'O masculino',{service_name:'Corte Masculino'},{query:'corte',candidates})).rejects.toThrow('ENTITY_MENTION_CONFLICT');
});
it('a token common to multiple options cannot identify one of them',async()=>{
  const rows=[{id:'a',name:'Massagem Relaxante Longa'},{id:'b',name:'Massagem Relaxante Breve'}];io.services.mockResolvedValue(rows);
  await expect(validateSchedulingEntityMentions(actor,'A relaxante',{service_name:rows[0].name},{query:'Massagem',candidates:rows})).rejects.toThrow('ENTITY_MENTION_CONFLICT');
});
it('does not accept an unoffered candidate even if catalog search returns it',async()=>{
  io.services.mockResolvedValue([...candidates,{id:'z',name:'Corte Infantil'}]);
  await expect(validateSchedulingEntityMentions(actor,'O infantil',{service_name:'Corte Infantil'},{query:'corte',candidates})).rejects.toThrow('ENTITY_MENTION_CONFLICT');
});
it('keeps initial-turn grounding strict when there is no backend clarification',async()=>{
  await expect(validateSchedulingEntityMentions(actor,'O masculino',{service_name:'Corte Masculino'})).rejects.toThrow('ENTITY_MENTION_CONFLICT');expect(io.services).not.toHaveBeenCalled();
});
it('does not mistake an isolated unique article or fragment for the distinguishing candidate name',async()=>{
  const rows=[{id:'a',name:'Corte O Masculino'},{id:'b',name:'Corte Feminino'}];io.services.mockResolvedValue(rows);
  await expect(validateSchedulingEntityMentions(actor,'O feminino',{service_name:rows[0].name},{query:'corte',candidates:rows})).rejects.toThrow('ENTITY_MENTION_CONFLICT');
});
it.each([
  ['Corte Anti-frizz Final','Corte Definido Final','O anti-frizz.'],
  ['Corte Anti-frizz Final','Corte Anti frizz Final','O anti-frizz.'],
  ['Tratamento Óleo+Argan Longo','Tratamento Óleo+Jojoba Longo','Argan.'],
])('preserves literal punctuation while distinguishing %s',async(name,other,message)=>{
 const rows=[{id:'a',name},{id:'b',name:other}];io.services.mockResolvedValue(rows);
 await expect(validateSchedulingEntityMentions(actor,message,{service_name:name},{query:name.split(' ')[0],candidates:rows})).resolves.toBeUndefined();
});
