// Temporary local homologation ingress. Expose only this listener through HTTPS.
// No credentials, cookies, admin pages or database ports are forwarded.
import http from "node:http";
if (process.env.APP_ENV !== "test") throw new Error("Test environment required");
let active = 0;
const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method !== "POST" || url.pathname !== "/api/webhooks/mercadopago") { res.writeHead(404).end(); return; }
  if (active >= 10) { res.writeHead(429).end(); return; }
  active++;
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413).end(); return; } chunks.push(chunk); }
    const headers = {};
    for (const key of ["content-type", "x-signature", "x-request-id"]) if (typeof req.headers[key] === "string") headers[key] = req.headers[key];
    const response = await fetch("http://127.0.0.1:3067" + url.pathname + url.search, {
      method: "POST", headers, body: Buffer.concat(chunks), signal: AbortSignal.timeout(55000),
    });
    // Evidence contains no secret, signature, body, IP, URL query or personal data.
    console.log(JSON.stringify({ at: new Date().toISOString(), status: response.status, signed: Boolean(headers["x-signature"]), requestId: headers["x-request-id"]?.slice(0, 100) }));
    res.writeHead(response.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(await response.text());
  } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
  finally { active--; }
});
server.requestTimeout = 60000;
server.headersTimeout = 10000;
server.listen(3068, "127.0.0.1", () => console.log("Test webhook ingress listening on loopback:3068"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
