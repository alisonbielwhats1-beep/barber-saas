import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { guardedFetch, budgetSnapshot, MAX_BODY_BYTES, MAX_INPUT_TOKENS_UPPER, PROTOCOL_OVERHEAD_TOKENS, MAX_OUTPUT_TOKENS, RESERVED_MICRO_USD } = require('../../../scripts/secretary-staging-api-budget.cjs') as {
  budgetSnapshot: (journal:string,options?:{limit:number})=>{scope:string;project_remaining_usd:null;used:number;remaining:number;limit:number;reserved_estimated_usd_upper:number;remaining_reservation_usd_upper:number;journal_sha256:string;journal_bytes:number};
  MAX_BODY_BYTES:number;MAX_INPUT_TOKENS_UPPER:number;PROTOCOL_OVERHEAD_TOKENS:number;MAX_OUTPUT_TOKENS:number;RESERVED_MICRO_USD:number;
  guardedFetch: (original: typeof fetch, journal: string, options?: { limit: number }) => typeof fetch & {flushObservations():Promise<void>};
};
const url = 'https://api.openai.com/v1/responses';
const payload = { model: 'gpt-6-luna', store: false, stream: false, max_output_tokens: 1200,
  tools: [{ type: 'function', name: 'select_capabilities' }], input: 'synthetic' };
const request = (patch = {}) => ({ method: 'POST', body: JSON.stringify({ ...payload, ...patch }) });
async function fixture(run: (file: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'secretary-budget-'));
  try { const file=join(dir, 'journal.jsonl');writeFileSync(file,'');await run(file); } finally { rmSync(dir, { recursive: true, force: true }); }
}
describe('staging-only durable API budget (offline; zero paid requests)', () => {
  it('records usage, not request body or credentials, and preserves the response', () => fixture(async file => {
    const network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ usage: { input_tokens: 100, output_tokens: 20 }, output: 'synthetic' })));
    const guarded = guardedFetch(network, file);
    const response = await guarded(url, { ...request(), headers: { Authorization: 'Bearer private-synthetic' } });
    expect((await response.json()).output).toBe('synthetic');
    await guarded.flushObservations();
    const log = readFileSync(file, 'utf8');
    expect(log).not.toMatch(/private-synthetic|"input":|Authorization/);
    expect(log).toContain('estimated_usd_upper');
    expect(network).toHaveBeenCalledTimes(1);
  }));
  it('blocks after the limit and preserves reservations across recreation/restart', () => fixture(async file => {
    const network = vi.fn<typeof fetch>(async () => new Response('{}'));
    const guarded = guardedFetch(network, file, { limit: 1 });
    await guarded(url, request());
    await guarded.flushObservations();
    await expect(guardedFetch(network, file, { limit: 1 })(url, request())).rejects.toThrow('STAGING_BUDGET_EXHAUSTED');
    expect(network).toHaveBeenCalledTimes(1);
  }));
  it('does not refund an uncertain request or retry it', () => fixture(async file => {
    const network = vi.fn<typeof fetch>(async () => { throw Error('sensitive provider body'); });
    await expect(guardedFetch(network, file, { limit: 1 })(url, request())).rejects.toThrow('STAGING_PROVIDER_REQUEST_FAILED');
    await expect(guardedFetch(network, file, { limit: 1 })(url, request())).rejects.toThrow('STAGING_BUDGET_EXHAUSTED');
    expect(readFileSync(file, 'utf8')).not.toContain('sensitive provider body');
    expect(network).toHaveBeenCalledTimes(1);
  }));
  it.each([{ store: true }, { max_output_tokens: 8193 }, { model: 'other' }, { tools: [{ type: 'web_search' }] }, { input: 'x'.repeat(256001) }])('rejects unbounded/provider-changing payload before network', patch => fixture(async file => {
    const network = vi.fn<typeof fetch>();
    await expect(guardedFetch(network, file)(url, request(patch))).rejects.toThrow('STAGING_BUDGET_REQUEST');
    expect(network).not.toHaveBeenCalled();
  }));
  it('fails closed for corrupt journal and an existing lock', () => fixture(async file => {
    const network = vi.fn<typeof fetch>();
    writeFileSync(file, 'not-json');
    await expect(guardedFetch(network, file)(url, request())).rejects.toThrow();
    writeFileSync(file + '.lock', '');
    await expect(guardedFetch(network, file)(url, request())).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  }));
  it('leaves internal backend requests unchanged', () => fixture(async file => {
    const network = vi.fn<typeof fetch>(async () => new Response('PONG'));
    expect(await (await guardedFetch(network, file)('http://redis-http:80', { method: 'POST' })).text()).toBe('PONG');
  }));
});

describe('passive capture never weakens staging admission', () => {
  it('keeps an unread response cancellable while its paid attempt remains reserved', () => fixture(async file => {
    const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }));
    const network = vi.fn<typeof fetch>(async () => response);
    const guarded = guardedFetch(network, file, { limit: 1 });
    const received = await guarded(url, request());
    const settled = await Promise.race([
      received.body!.cancel().then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 250)),
    ]);
    expect(settled).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    await guarded.flushObservations();
    const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(rows.map(row => row.status)).toEqual(['STARTED']);
    await expect(guarded(url, request())).rejects.toThrow('STAGING_BUDGET_EXHAUSTED');
    expect(network).toHaveBeenCalledOnce();
  }));

  it('admits continuation tools and preserves payload/session/signal without requiring discovery', () => fixture(async file => {
    const response = new Response(JSON.stringify({ usage: { input_tokens: 4, output_tokens: 2 } }));
    const network = vi.fn<typeof fetch>(async () => response), controller = new AbortController();
    const init = { ...request({ tools: [{ type: 'function', name: 'upsert_action_draft' }] }),
      signal: controller.signal, headers: { 'x-session': 'synthetic-session' } };
    const guarded = guardedFetch(network, file);
    expect(await guarded(url, init)).toBe(response);
    await response.text(); await guarded.flushObservations();
    expect(network).toHaveBeenCalledExactlyOnceWith(url, init);
    expect(readFileSync(file, 'utf8')).toContain('SUCCEEDED');
  }));

  it('fails closed before transport when the mandatory reservation cannot be written', () => fixture(async file => {
    const network = vi.fn<typeof fetch>();
    await expect(guardedFetch(network, join(file, 'missing', 'journal'))(url, request())).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  }));

  it('isolates post-transport journal failure while retaining the reservation', () => fixture(async file => {
    const response = new Response(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
    const network = vi.fn<typeof fetch>(async () => response);
    const guarded = guardedFetch(network, file, { limit: 1 });
    expect(await guarded(url, request())).toBe(response);
    // The response is successful even if its usage diagnostic fails. The original
    // reservation is durable and remains enough to deny another paid attempt.
    const diskFailure = vi.spyOn(require('node:fs'), 'appendFileSync').mockImplementation(() => { throw Error('DISK_FULL'); });
    try {
      expect(await response.text()).toContain('input_tokens');
      await guarded.flushObservations();
    } finally { diskFailure.mockRestore(); }
    expect(readFileSync(file, 'utf8')).toContain('STARTED');
    await expect(guarded(url, request())).rejects.toThrow('STAGING_BUDGET_EXHAUSTED');
    expect(network).toHaveBeenCalledOnce();
  }));
});

it('composes budget and provider diagnostics without rereading the body or duplicating attempts', () => fixture(async file => {
  const { observeProvider } = require('../../../scripts/secretary-passive-observer.cjs');
  const response = new Response(JSON.stringify({ id: 'synthetic', output: [], usage: { input_tokens: 8, output_tokens: 4 } }));
  const network = vi.fn<typeof fetch>(async () => response), records: unknown[] = [];
  const budget = guardedFetch(network, file, { limit: 1 });
  const observed = observeProvider(budget, (data: unknown) => records.push(data));
  const received = await observed(url, request());
  expect(received).toBe(response);
  expect((await received.json()).id).toBe('synthetic');
  await observed.flushObservations(); await budget.flushObservations();
  expect(records).toHaveLength(1);
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(rows.map(row => row.status)).toEqual(['STARTED', 'SUCCEEDED']);
  expect(rows[1].usage).toMatchObject({ input_tokens: 8, output_tokens: 4 });
  expect(network).toHaveBeenCalledOnce();
}));


describe('same manual session, Golden-aligned admission and durable reservation',()=>{
  const historical=()=>Array.from({length:17},(_,i)=>[
    {id:'history_'+i,status:'STARTED',model:'gpt-6-luna',body_bytes:1000,max_output_tokens:1200,reserved_estimated_usd_upper:.035},
    {id:'history_'+i,status:i%3===0?'UNKNOWN':i%3===1?'FAILED':'SUCCEEDED'},
  ]).flat().map(row=>JSON.stringify(row)+'\n').join('');
  it('keeps 17 historical STARTED charged, admits exactly three more and never resets/refunds',()=>fixture(async file=>{
    const before=historical();writeFileSync(file,before);
    const initial=budgetSnapshot(file);
    expect(initial).toMatchObject({scope:'this_journal_only',project_remaining_usd:null,used:17,remaining:3,limit:20,reserved_estimated_usd_upper:.595,remaining_reservation_usd_upper:.105});
    expect(budgetSnapshot(file)).toEqual(initial);expect(readFileSync(file,'utf8')).toBe(before);
    const transport=vi.fn<typeof fetch>(async()=>new Response('{}'));
    for(let i=0;i<3;i++)await guardedFetch(transport,file)(url,request({max_output_tokens:8192}));
    await expect(guardedFetch(transport,file)(url,request())).rejects.toThrow('STAGING_BUDGET_EXHAUSTED');
    expect(budgetSnapshot(file)).toMatchObject({used:20,remaining:0,reserved_estimated_usd_upper:.7});
    expect(readFileSync(file,'utf8').startsWith(before)).toBe(true);expect(transport).toHaveBeenCalledTimes(3);
  }));
  it('reserves .035 only after checking the exact UTF8 byte boundary and output8192',()=>fixture(async file=>{
    expect(MAX_OUTPUT_TOKENS).toBe(8192);expect(MAX_INPUT_TOKENS_UPPER).toBe(64000);expect(PROTOCOL_OVERHEAD_TOKENS).toBe(8192);expect(RESERVED_MICRO_USD).toBe(35000);
    const empty=JSON.stringify({...payload,max_output_tokens:8192,input:''}),room=MAX_BODY_BYTES-Buffer.byteLength(empty),init=request({max_output_tokens:8192,input:'x'.repeat(room)});
    expect(Buffer.byteLength(init.body)+8192).toBe(64000);
    const transport=vi.fn<typeof fetch>(async()=>new Response('{}'));
    await guardedFetch(transport,file)(url,init);
    const started=JSON.parse(readFileSync(file,'utf8').split('\n')[0]);
    expect(started).toMatchObject({body_bytes:55808,input_tokens_upper:64000,max_output_tokens:8192,reserved_estimated_usd_upper:.035,request_estimated_usd_upper:.012096});
    await expect(guardedFetch(transport,file)(url,request({max_output_tokens:8192,input:'x'.repeat(room)+'é'}))).rejects.toThrow('STAGING_BUDGET_REQUEST');
    expect(transport).toHaveBeenCalledOnce();expect(budgetSnapshot(file).used).toBe(1);
  }));
  it('fsync happens after STARTED write and before any transport; a flush failure is fail-closed',()=>fixture(async file=>{
    const events:string[]=[],realSync=require('node:fs').fsyncSync;
    const sync=vi.spyOn(require('node:fs'),'fsyncSync').mockImplementation((...args:unknown[])=>{events.push('fsync');expect(readFileSync(file,'utf8')).toContain('STARTED');return realSync(...args);});
    const transport=vi.fn<typeof fetch>(async()=>{events.push('fetch');return new Response('{}');});
    try{await guardedFetch(transport,file)(url,request({max_output_tokens:8192}));expect(events).toEqual(['fsync','fetch']);}finally{sync.mockRestore();}
    const failed=vi.spyOn(require('node:fs'),'fsyncSync').mockImplementation(()=>{throw Error('FSYNC_FAILED');});
    try{await expect(guardedFetch(transport,file)(url,request())).rejects.toThrow('FSYNC_FAILED');}finally{failed.mockRestore();}
    expect(transport).toHaveBeenCalledOnce();expect(budgetSnapshot(file).used).toBe(2);
  }));
  it('does not consume or clone a Request stream to inspect admission',()=>fixture(async file=>{
    const req=new Request(url,{method:'POST',body:JSON.stringify(payload)}),clone=vi.spyOn(req,'clone'),read=vi.spyOn(req,'text');
    const transport=vi.fn<typeof fetch>();
    await expect(guardedFetch(transport,file)(req)).rejects.toThrow('STAGING_BUDGET_REQUEST');
    expect(req.bodyUsed).toBe(false);expect(clone).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
    expect(budgetSnapshot(file).used).toBe(0);
  }));
  it.each([
    {previous_response_id:'remote-state'}, {conversation:'remote-conversation'}, {service_tier:'priority'}, {background:true},
    {parallel_tool_calls:true}, {include:['extra']}, {input:[{role:'user',content:[{type:'input_image',image_url:'remote'}]}]},
    {input:[{role:'user',content:[{type:'input_file',file_id:'remote'}]}]}, {input:[{type:'item_reference',id:'remote'}]},
    {tools:[{type:'function',name:'select_capabilities',defer_loading:true}]},
    {tool_choice:{type:'function',name:'foreign'}},
  ])('rejects requests whose price/input cannot be bounded by text bytes: %j',patch=>fixture(async file=>{
    const transport=vi.fn<typeof fetch>();await expect(guardedFetch(transport,file)(url,request(patch))).rejects.toThrow('STAGING_BUDGET_REQUEST');
    expect(transport).not.toHaveBeenCalled();expect(budgetSnapshot(file).used).toBe(0);
  }));
  it('fails closed on valid JSON with invalid history and on missing journals',()=>fixture(async file=>{
    const transport=vi.fn<typeof fetch>();
    for(const contents of ['{}\n','[]\n',JSON.stringify({id:'x',status:'STARTED',reserved_estimated_usd_upper:.001})+'\n',historical().trimEnd()]){
      writeFileSync(file,contents);await expect(guardedFetch(transport,file)(url,request())).rejects.toThrow('STAGING_BUDGET_JOURNAL');
    }
    rmSync(file);await expect(guardedFetch(transport,file)(url,request())).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();expect(()=>budgetSnapshot(file)).toThrow();
  }));
  it('preserves the full text-only SDK request with schema refs, signals and headers',()=>fixture(async file=>{
    const init=request({max_output_tokens:8192,instructions:'Instruções sintéticas',input:[{role:'system',content:[{type:'input_text',text:'Contexto'}]},{type:'message',role:'user',content:'Pedido'}],parallel_tool_calls:false,include:[],tool_choice:{type:'function',name:'select_capabilities'},tools:[{type:'function',name:'select_capabilities',strict:true,parameters:{type:'object',properties:{operations:{$ref:'#/$defs/list'}},$defs:{list:{type:'array',items:{type:'string'}}},required:['operations'],additionalProperties:false}}]});
    const transport=vi.fn<typeof fetch>(async()=>new Response('{}')),before=JSON.stringify(init);
    await guardedFetch(transport,file)(url,init);expect(transport).toHaveBeenCalledExactlyOnceWith(url,init);expect(JSON.stringify(init)).toBe(before);
  }));
});

it('completes partial reservation writes before transport and blocks zero progress',()=>fixture(async file=>{
  const io=require('node:fs'),original=io.writeSync;
  const partial=vi.spyOn(io,'writeSync').mockImplementation((fd,buffer,offset,length)=>original(fd,buffer,offset,Math.min(Number(length),17)));
  const transport=vi.fn<typeof fetch>(async()=>{expect(budgetSnapshot(file).used).toBe(1);return new Response('{}');});
  try{await guardedFetch(transport,file)(url,request());expect(partial.mock.calls.length).toBeGreaterThan(1);}finally{partial.mockRestore();}
  const stalled=vi.spyOn(io,'writeSync').mockReturnValue(0);
  try{await expect(guardedFetch(transport,file)(url,request())).rejects.toThrow('STAGING_BUDGET_WRITE');}finally{stalled.mockRestore();}
  expect(transport).toHaveBeenCalledOnce();expect(budgetSnapshot(file).used).toBe(1);
}));
