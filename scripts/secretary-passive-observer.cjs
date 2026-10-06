'use strict';
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const decode = { gzip: promisify(zlib.gunzip), br: promisify(zlib.brotliDecompress), deflate: promisify(zlib.inflate) };
const LIMIT = 500000;

/** Optional diagnostics never determine request success. Pending work is bounded;
 * explicit drain is for test/shutdown reconciliation, never the request path. */
function observationQueue({ maxPending = 64, flushTimeoutMs = 2000 } = {}) {
  const pending = new Set();
  let errors = 0, dropped = 0;
  return {
    schedule(work) {
      if (pending.size >= maxPending) { dropped++; return false; }
      const task = new Promise(resolve => setImmediate(resolve)).then(work).catch(() => { errors++; });
      pending.add(task); void task.finally(() => pending.delete(task));
      return true;
    },
    async flush() {
      let timer;
      try {
        await Promise.race([
          (async () => { while (pending.size) await Promise.all([...pending]); })(),
          new Promise(resolve => { timer = setTimeout(resolve, flushTimeoutMs); }),
        ]);
      } finally { clearTimeout(timer); }
    },
    get errors() { return errors; },
    get dropped() { return dropped; },
    get pending() { return pending.size; },
  };
}
function schedule(queue, work) {
  try { queue.schedule(work); } catch { /* Optional instrumentation can fail closed only to capture. */ }
}

function observe(request, response, record, queue = observationQueue()) {
  const began = Date.now(), input = [], output = [];
  let inputBytes = 0, outputBytes = 0, captureError = false;
  const capture = (list, chunk, encoding, inbound) => {
    try {
      if (chunk == null) return;
      const size = typeof chunk === 'string' ? Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined) : chunk.byteLength;
      const total = inbound ? (inputBytes += size) : (outputBytes += size);
      if (total <= LIMIT) list.push(Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
    } catch { captureError = true; }
  };
  const emit = request.emit, write = response.write, end = response.end;
  request.emit = function(event, ...args) { if (event === 'data') capture(input, args[0], undefined, true); return emit.call(this, event, ...args); };
  response.write = function(chunk, ...args) { capture(output, chunk, args[0], false); return write.call(this, chunk, ...args); };
  response.end = function(chunk, ...args) { capture(output, chunk, args[0], false); return end.call(this, chunk, ...args); };
  response.once('finish', () => {
    try {
      const status = response.statusCode, latency_ms = Date.now() - began, encoding = response.getHeader('content-encoding');
      schedule(queue, async () => {
        let body = Buffer.concat(output);
        try { if (decode[encoding] && outputBytes <= LIMIT) body = await decode[encoding](body, {maxOutputLength: LIMIT}); }
        catch { captureError = true; body = Buffer.alloc(0); }
        await record({status,latency_ms,input:Buffer.concat(input).toString('utf8'),output:body.toString('utf8'),input_truncated:inputBytes>LIMIT,output_truncated:outputBytes>LIMIT,
          ...(captureError ? {observation_error:'CAPTURE_DECODE_FAILED'} : {})});
      });
    } catch { /* Even unavailable metadata/queue cannot escape the finish event. */ }
  });
  return queue;
}

/** Observe only consumption initiated by the SDK/caller. A cloned/tee'd body is
 * an active second reader: it changes cancellation and backpressure. Never read,
 * clone, lock or cancel the body here. Unread/direct-stream bodies stay uncaptured.
 * The installed OpenAI SDK consumes non-streaming responses with text(). */
function observeConsumedResponse(response, record, queue = observationQueue()) {
  let captured = false;
  for (const method of ['text', 'json']) {
    try {
      const original = response[method];
      if (typeof original !== 'function') continue;
      Object.defineProperty(response, method, { configurable: true, writable: true, value: function(...args) {
        const result = original.apply(this, args);
        if (this === response) {
          try {
            void result.then(value => {
              if (captured) return;
              captured = true;
              schedule(queue, async () => {
                let data = null;
                try {
                  const text = method === 'text' ? value : JSON.stringify(value);
                  if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= LIMIT) data = JSON.parse(text);
                } catch { /* Invalid/oversize capture is optional, not a product error. */ }
                await record(data);
              });
            }, () => {}).catch(() => {});
          } catch { /* Do not replace the caller's result if a capture hook fails. */ }
        }
        return result;
      } });
    } catch { /* A frozen/custom Response can be used without optional diagnostics. */ }
  }
  return response;
}
function observeProvider(original, record, queue = observationQueue()) {
  const observed = async (input, init) => {
    const response = await original(input, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input instanceof URL ? input.href : null;
      if (url === 'https://api.openai.com/v1/responses') {
        const http_status = response.status;
        observeConsumedResponse(response, data => record({response_id:data?.id,
          output:Array.isArray(data?.output) ? data.output.filter(x=>x.type==='function_call') : [],http_status}), queue);
      }
    } catch { /* Diagnostics never consume or replace the response. */ }
    return response;
  };
  observed.flushObservations = () => queue.flush();
  return observed;
}
module.exports = { observe, observeProvider, observationQueue, observeConsumedResponse };
