import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { OrchestratorConversation } from "@everflare/agents/orchestrator";

const ttlMs = 2 * 60 * 60 * 1000;
const maxTokenLength = 800000;
function key(secret: string) {
  if (secret.length < 32) throw new Error("Conversation secret unavailable");
  return createHash("sha256").update(`hq-orchestrator-conversation-v1:${secret}`).digest();
}

// Opaque state kept only in page memory. Authentication, actor and registry are
// checked again on every request; no browser-supplied history or agent IDs.
export function sealConversation(state: OrchestratorConversation, actor: string, registry: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`${actor}:${registry}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: 1, expires: Date.now() + ttlMs, state }), "utf8"), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  if (token.length > maxTokenLength) throw new Error("Conversation limit");
  return token;
}

export function openConversation(token: string, actor: string, registry: string, secret: string): OrchestratorConversation {
  if (token.length > maxTokenLength || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid conversation");
  const bytes = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${actor}:${registry}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  if (value.version !== 1 || !Number.isFinite(value.expires) || value.expires <= Date.now() || value.expires > Date.now() + ttlMs || !value.state) throw new Error("Expired conversation");
  return value.state;
}
