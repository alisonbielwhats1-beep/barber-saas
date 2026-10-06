import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
const require = createRequire(import.meta.url);
type Queue = {flush():Promise<void>;errors:number};
const { observe, observeProvider } = require('../../../scripts/secretary-passive-observer.cjs') as {
  observe(req:IncomingMessage,res:ServerResponse,record:(data:Record<string,unknown>)=>unknown):Queue;
  observeProvider(original:typeof fetch,record:(data:Record<string,unknown>)=>unknown):typeof fetch & {flushObservations():Promise<void>};
};
it.each([false,true])('leaves delayed consumer, body and compressed response intact (gzip=%s)',async gzip=>{
  const records:Record<string,unknown>[]=[]; let observation:Queue;
  const server=createServer(async(req,res)=>{
    observation=observe(req,res,data=>records.push(data));
    await new Promise(resolve=>setTimeout(resolve,30));
    let body=''; for await(const chunk of req)body+=chunk;
    const result=Buffer.from(JSON.stringify({body}));
    if(gzip)res.setHeader('content-encoding','gzip'); res.end(gzip?gzipSync(result):result);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address(); if(!address||typeof address==='string')throw Error('PORT');
    const response=await fetch(`http://127.0.0.1:${address.port}`,{method:'POST',body:'{"synthetic":"11h"}'});
    expect(await response.json()).toEqual({body:'{"synthetic":"11h"}'});
    await observation!.flush(); expect(records[0].input).toBe('{"synthetic":"11h"}');
    expect(JSON.parse(String(records[0].output))).toEqual({body:records[0].input});
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('returns the exact provider response before diagnostics and isolates disk errors',async()=>{
  const response=new Response(JSON.stringify({id:'synthetic',output:[]}));
  const transport=vi.fn<typeof fetch>(async()=>response),record=vi.fn(()=>{throw Error('DISK_FULL');});
  const wrapped=observeProvider(transport,record),init={method:'POST',body:'unchanged'};
  expect(await wrapped('https://api.openai.com/v1/responses',init)).toBe(response);
  expect(record).not.toHaveBeenCalled(); expect(transport).toHaveBeenCalledWith('https://api.openai.com/v1/responses',init);
  expect(await response.json()).toEqual({id:'synthetic',output:[]});
  await wrapped.flushObservations(); expect(record).toHaveBeenCalledOnce();
});
it('does not turn a malformed optional capture into a provider failure',async()=>{
  const response=new Response('not JSON'),record=vi.fn();
  const wrapped=observeProvider(async()=>response,record);
  expect(await (await wrapped('https://api.openai.com/v1/responses')).text()).toBe('not JSON');
  await wrapped.flushObservations(); expect(record).toHaveBeenCalledOnce();
});

it('does not consume unread provider bodies or delay caller cancellation', async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  const record = vi.fn(), wrapped = observeProvider(async () => response, record);
  const received = await wrapped('https://api.openai.com/v1/responses');
  const settled = await Promise.race([
    received.body!.cancel().then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 250)),
  ]);
  expect(settled).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  await wrapped.flushObservations();
  expect(record).not.toHaveBeenCalled();
});

it('preserves request identity, abort signal, caller headers and transport error identity', async () => {
  const controller = new AbortController(), failure = new DOMException('synthetic abort', 'AbortError');
  const request = new Request('https://api.openai.com/v1/responses', { method: 'POST', body: 'unchanged', headers: { 'x-session': 'synthetic' } });
  const init = { signal: controller.signal }, network = vi.fn<typeof fetch>(async () => { throw failure; });
  const wrapped = observeProvider(network, vi.fn());
  await expect(wrapped(request, init)).rejects.toBe(failure);
  expect(network).toHaveBeenCalledExactlyOnceWith(request, init);
  expect(await request.text()).toBe('unchanged');
});

it('captures the SDK text read without changing the returned promise or bytes', async () => {
  const body = JSON.stringify({ id: 'synthetic', output: [{ type: 'function_call', arguments: '{"time":"09:00"}' }] });
  const response = new Response(body), originalText = response.text.bind(response);
  let originalPromise: Promise<string> | undefined;
  response.text = () => (originalPromise = originalText());
  const records: Record<string, unknown>[] = [];
  const wrapped = observeProvider(async () => response, data => records.push(data));
  const received = await wrapped('https://api.openai.com/v1/responses');
  const consumer = received.text();
  expect(consumer).toBe(originalPromise);
  expect(await consumer).toBe(body);
  await wrapped.flushObservations();
  expect(records).toHaveLength(1);
  expect(records[0].response_id).toBe('synthetic');
});

it('does not expose the consumer JSON object to a mutating diagnostic callback', async () => {
  const response = new Response(JSON.stringify({ id: 'synthetic', output: [{ type: 'function_call', arguments: '{"price":100}' }] }));
  const wrapped = observeProvider(async () => response, data => {
    (data.output as { arguments: string }[])[0].arguments = 'changed by diagnostics';
  });
  const received = await wrapped('https://api.openai.com/v1/responses');
  const parsed = await received.json();
  await wrapped.flushObservations();
  expect(parsed.output[0].arguments).toBe('{"price":100}');
});

it('isolates failed HTTP recording and unavailable observation queues from status, cookies and bytes', async () => {
  let observation: Queue;
  const server = createServer(async (req, res) => {
    observation = observe(req, res, () => { throw Error('DISK_FULL'); });
    await new Promise(resolve => setTimeout(resolve, 10));
    let body = ''; for await (const chunk of req) body += chunk;
    res.statusCode = 201;
    res.setHeader('set-cookie', 'session=unchanged; HttpOnly; SameSite=Lax');
    res.write(body.slice(0, 3));
    res.end(body.slice(3));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('PORT');
    const response = await fetch(`http://127.0.0.1:${address.port}`, { method: 'POST', body: 'synthetic bytes' });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toBe('session=unchanged; HttpOnly; SameSite=Lax');
    expect(await response.text()).toBe('synthetic bytes');
    await observation!.flush();
    expect(observation!.errors).toBe(1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('does not let a failing queue escape the HTTP finish event', () => {
  const { EventEmitter } = require('node:events');
  const request = new EventEmitter(), response = new EventEmitter();
  response.write = () => false; response.end = () => response; response.getHeader = () => undefined;
  const brokenQueue = { schedule() { throw Error('CAPTURE_UNAVAILABLE'); }, async flush() {}, errors: 0 };
  const observerModule = require('../../../scripts/secretary-passive-observer.cjs');
  observerModule.observe(request, response, vi.fn(), brokenQueue);
  expect(response.write('unchanged')).toBe(false);
  expect(response.end()).toBe(response);
  expect(() => response.emit('finish')).not.toThrow();
});

it('bounds pending diagnostics and shutdown waits without dropping runtime work', async () => {
  const { observationQueue } = require('../../../scripts/secretary-passive-observer.cjs');
  const queue = observationQueue({ maxPending: 2, flushTimeoutMs: 25 });
  let release!: () => void;
  const stalled = new Promise<void>(resolve => { release = resolve; });
  const work = vi.fn(() => stalled);
  expect(queue.schedule(work)).toBe(true);
  expect(queue.schedule(work)).toBe(true);
  expect(queue.schedule(work)).toBe(false);
  await queue.flush();
  expect(work).toHaveBeenCalledTimes(2);
  expect(queue.pending).toBe(2);
  expect(queue.dropped).toBe(1);
  release(); await queue.flush();
  expect(queue.pending).toBe(0);
});

it.each([true, false])('preserves consumed-stream errors and frozen response behavior (frozen=%s)', async frozen => {
  const error = new DOMException('synthetic abort', 'AbortError');
  const response = new Response(new ReadableStream({ start(controller) { controller.error(error); } }));
  if (frozen) Object.freeze(response);
  const wrapped = observeProvider(async () => response, vi.fn());
  const received = await wrapped('https://api.openai.com/v1/responses');
  expect(received).toBe(response);
  await expect(received.text()).rejects.toBe(error);
  await wrapped.flushObservations();
});

it('preserves oversize provider bytes while dropping optional body capture', async () => {
  const text = JSON.stringify({ id: 'oversize', output: [{ type: 'function_call', arguments: 'x'.repeat(500001) }] });
  const records: Record<string, unknown>[] = [], response = new Response(text);
  const wrapped = observeProvider(async () => response, data => records.push(data));
  expect(await (await wrapped('https://api.openai.com/v1/responses')).text()).toBe(text);
  await wrapped.flushObservations();
  expect(records).toEqual([{ response_id: undefined, output: [], http_status: 200 }]);
});

it('does not coerce transport inputs a second time just to observe them', async () => {
  const toString = vi.fn(() => 'https://api.openai.com/v1/responses');
  const input = { toString } as unknown as Request;
  const response = new Response('{}'), network = vi.fn<typeof fetch>(async () => response);
  expect(await observeProvider(network, vi.fn())(input)).toBe(response);
  expect(network).toHaveBeenCalledExactlyOnceWith(input, undefined);
  expect(toString).not.toHaveBeenCalled();
});
