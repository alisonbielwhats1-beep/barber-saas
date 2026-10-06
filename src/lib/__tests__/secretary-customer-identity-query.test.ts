import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import type {Tx} from '../prisma-tenant';
const db=vi.hoisted(()=>({tx:undefined as unknown as Tx,rows:[] as {id:string;salonId:string;name:string;phone:string;email:string;mergedIntoId:string|null}[],role:'OWNER',search:vi.fn(),read:vi.fn(),write:vi.fn()}));
vi.mock('../prisma-tenant',()=>({withTenant:(_actor:unknown,work:(tx:Tx)=>unknown)=>work(db.tx)}));
vi.mock('../customer-actions',()=>({upsertCustomerDraft:db.write,proposeCustomerChange:db.write,confirmCustomerChange:db.write}));
import {searchSalonCustomer} from '../customer-catalog';
import {applyCustomerInterpretation,customerState} from '../secretary-customers';
const actor={salonId:'ours',userId:'owner'};
beforeEach(()=>{
 vi.clearAllMocks();db.role='OWNER';vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));
 db.rows=[{id:'one',salonId:'ours',name:'Rita Costa',phone:'11999990011',email:'rita1@example.test',mergedIntoId:null},{id:'two',salonId:'ours',name:'Rita Costa',phone:'11999990022',email:'rita2@example.test',mergedIntoId:null},{id:'foreign',salonId:'theirs',name:'Rita Costa',phone:'11999990033',email:'rita3@example.test',mergedIntoId:null}];
 db.search.mockImplementation(async({where,select})=>db.rows.filter(row=>row.salonId===where.salonId&&row.mergedIntoId===where.mergedIntoId&&where.OR.some((q:Record<string,{contains?:string;equals?:string}>)=>Object.entries(q).some(([field,value])=>value.equals?String(row[field as keyof typeof row]).toLowerCase()===value.equals.toLowerCase():String(row[field as keyof typeof row]).toLowerCase().includes(value.contains!.toLowerCase())))).map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>select[key]))));
 db.read.mockImplementation(async({where,select})=>{const row=db.rows.find(row=>row.id===where.id&&row.salonId===where.salonId&&row.mergedIntoId===where.mergedIntoId);return row?Object.fromEntries(Object.entries(row).filter(([key])=>select[key])):null;});
 db.tx={$queryRaw:vi.fn(async(parts:readonly string[])=>parts.join('').includes('"Membership"')?[{role:db.role}]:[{accessStatus:'APPROVED'}]),clientProfile:{findMany:db.search,findFirst:db.read}} as unknown as Tx;
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();expect(db.write).not.toHaveBeenCalled();vi.unstubAllGlobals();});
it('refines a homonym with an exact email and preserves the requested read fields',async()=>{
 const c=customerState();await applyCustomerInterpretation(actor,c,{operation:'customer.read',target_name:'Rita Costa',requested_fields:['phone']});expect(c.candidates).toHaveLength(2);
 await applyCustomerInterpretation(actor,c,{target_name:'RITA2@example.test'});expect(c.target).toBe('two');expect(c.message).toBe('Telefone: 11999990022');expect(c.read_fields).toEqual(['phone']);expect(c.patch).toEqual({});
});
it('exact email query never becomes phone digits or a partial email search',async()=>{
 expect(await searchSalonCustomer(db.tx,actor,'rita2@example.test')).toEqual([{id:'two',name:'Rita Costa',phone:expect.any(String)}]);
 expect(db.search.mock.calls[0][0]).toMatchObject({where:{salonId:'ours',mergedIntoId:null,OR:[{email:{equals:'rita2@example.test',mode:'insensitive'}}]},select:{id:true,name:true,phone:true},take:21});
 expect(await searchSalonCustomer(db.tx,actor,'rita2@example.tes')).toEqual([]);
});
it('keeps ambiguity for duplicated exact email identities',async()=>{
 db.rows[1].email=db.rows[0].email;const c=customerState();await applyCustomerInterpretation(actor,c,{operation:'customer.read',target_name:'rita1@example.test'});expect(c.candidates).toHaveLength(2);expect(c.target).toBeUndefined();expect(db.read).not.toHaveBeenCalled();
});
it('foreign and merged identities remain invisible',async()=>{
 db.rows[1].mergedIntoId='one';expect(await searchSalonCustomer(db.tx,actor,'rita2@example.test')).toEqual([]);expect(await searchSalonCustomer(db.tx,actor,'rita3@example.test')).toEqual([]);
});
it('email lookup adds no permission and returns no email or auth column in candidates',async()=>{
 const rows=await searchSalonCustomer(db.tx,actor,'rita1@example.test');expect(rows).toHaveLength(1);expect(Object.keys(rows[0]).sort()).toEqual(['id','name','phone']);expect(rows[0].phone).not.toBe('11999990011');
 db.role='PROFESSIONAL';await expect(searchSalonCustomer(db.tx,actor,'rita1@example.test')).rejects.toThrow('FORBIDDEN');
});
it.each(['rita1234@','rita1234@example','rita1234@@example.test','rita1234@.test'])('malformed email %s never selects by phone digits',async query=>{
 await expect(searchSalonCustomer(db.tx,actor,query)).rejects.toThrow('INVALID_EMAIL_REFERENCE');expect(db.search).not.toHaveBeenCalled();expect(db.read).not.toHaveBeenCalled();
});
it('asks for a complete invalid identity and recovers the same read without losing its projection',async()=>{
 const state=customerState();await applyCustomerInterpretation(actor,state,{operation:'customer.read',target_name:'Rita Costa',requested_fields:['phone']});
 await expect(applyCustomerInterpretation(actor,state,{target_name:'rita1234@'})).resolves.toBeUndefined();
 expect(state.target).toBeUndefined();expect(state.candidates).toBeUndefined();expect(state.message).toContain('e-mail completo');expect(state.read_fields).toEqual(['phone']);
 await applyCustomerInterpretation(actor,state,{target_name:'rita2@example.test'});expect(state.target).toBe('two');expect(state.message).toBe('Telefone: 11999990022');
});
it('retires the old selection card once a refined query resolves a single real customer',async()=>{
 const state=customerState();await applyCustomerInterpretation(actor,state,{operation:'customer.read',target_name:'Rita Costa'});expect(state.candidates).toHaveLength(2);
 await applyCustomerInterpretation(actor,state,{target_name:'rita2@example.test'});expect(state.target).toBe('two');expect(state.candidates).toBeUndefined();
});
