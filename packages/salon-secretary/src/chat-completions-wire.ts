import type { SecretaryModelProfile } from "./model-registry";

/** Chat Completions adapter of the Secretary's C4 call (any model whose registry profile has wire "chat-completions"; today
 * DeepSeek V4.1 Flash through OpenRouter). The cost guard validates what the SDK sends; this module only shapes the request a
 * provider receives and the answer the SDK reads back, as the model's profile says (measured on the Golden, 04/10/2026). */

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function fail(reason: string): never { throw new Error(`SECRETARY_OPENAI_COST_GUARD:${reason}`); }
export type ChatMessage = { role: "system" | "user"; content: string | { type: "text"; text: string }[] };
/** This process's request options of a chat model (model-registry.ts secretaryChatOptions): reasoning effort and pinned provider. */
export type ChatRequestOptions = { readonly reasoning?: string; readonly provider?: string };
const EFFORTS = ["low", "medium", "high"];

/** The fields the adapter adds to every call (the SDK never sends them): OpenRouter routing (only providers that honor every
 * parameter sent, the forced tool above all; one pinned provider without fallback when the options name it), reasoning
 * (off by default: C4 is one forced call and reasoning only added latency) and the profile's temperature (0: the same sentence
 * gets the same reading; Golden failures moved between runs at the provider default). */
export function chatRequestExtras(profile: SecretaryModelProfile, options: ChatRequestOptions = {}) {
  if (!profile.chat) fail("CHAT_MODEL");
  const reasoning = options.reasoning ?? "off", provider = options.provider;
  if ((reasoning !== "off" && !EFFORTS.includes(reasoning)) || (provider !== undefined && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(provider))) fail("OPENROUTER_OPTIONS");
  return { provider: provider ? { require_parameters: true, order: [provider], allow_fallbacks: false } : { require_parameters: true },
    reasoning: reasoning === "off" ? { enabled: false } : { effort: reasoning }, temperature: profile.chat.temperature };
}

/** The body the provider receives: the checked C4 payload with each content as one string (no provider reads OpenAI's cache
 * breakpoints; the stable prefix is cached by the provider itself), without OpenAI's `store` and without `parallel_tool_calls`
 * (one forced tool; almost no DeepSeek provider declares it, so with require_parameters it left no route: 404, 04/10), the tool
 * strict only when the profile says so (strict made the providers decode our 17 KB schema token by token and DeepSeek's answers
 * came out deformed: Golden 3/30; the same 5 failed requests 0/5 strict, 5/5 not), plus chatRequestExtras. The backend's typed
 * parser still validates every answer before it is used. */
export function chatOutboundBody(payload: Record<string, unknown> & { messages: ChatMessage[] }, profile: SecretaryModelProfile, options: ChatRequestOptions = {}) {
  const { store: _store, parallel_tool_calls: _parallel, messages, tools, ...rest } = payload; void _store; void _parallel;
  const strict = profile.chat?.strictTools ?? true;
  return { ...rest, tools: (tools as { type: string; function: Record<string, unknown> }[]).map(tool => ({ ...tool, function: { ...tool.function, strict } })),
    messages: messages.map(({ role, content }) => ({ role, content: typeof content === "string" ? content : content.map(part => part.text).join("\n") })),
    ...chatRequestExtras(profile, options) };
}

/** Without strict decoding a provider omits the keys it would have sent as null (Golden 04/10: answers understood, then refused by
 * the parser for a missing key, "Não entendi"). When the profile asks for it, the tool's arguments are completed by
 * completeOmittedNulls; nothing else in the answer changes. */
export async function completedToolArguments(response: Response, payload: Record<string, unknown>, profile: SecretaryModelProfile): Promise<Response> {
  if (!response.ok || !profile.chat?.completeOmittedNulls) return response;
  let body: unknown;
  try { body = await response.clone().json(); } catch { return response; }
  const tool = (payload.tools as { function: { name: string; parameters: unknown } }[])[0].function;
  const choices = record(body) && Array.isArray(body.choices) ? body.choices : [];
  const message = record(choices[0]) && record(choices[0].message) ? choices[0].message : undefined;
  if (!message || !Array.isArray(message.tool_calls)) return response;
  for (const call of message.tool_calls) {
    if (!record(call) || !record(call.function) || call.function.name !== tool.name || typeof call.function.arguments !== "string") continue;
    try { call.function.arguments = JSON.stringify(completeOmittedNulls(JSON.parse(call.function.arguments), tool.parameters, tool.parameters)); } catch { /* left as sent */ }
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length"); headers.delete("content-encoding");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

const resolveSchema = (schema: unknown, root: unknown): unknown => {
  let node = schema;
  for (let depth = 0; depth < 32 && record(node) && typeof node.$ref === "string"; depth++) {
    if (!node.$ref.startsWith("#/")) return undefined;
    node = node.$ref.slice(2).split("/").reduce<unknown>((at, part) => record(at) ? at[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined, root);
  }
  return node;
};
const admitsNull = (schema: unknown, root: unknown): boolean => {
  const node = resolveSchema(schema, root);
  if (!record(node)) return false;
  if (node.type === "null" || (Array.isArray(node.type) && node.type.includes("null")) || (Array.isArray(node.enum) && node.enum.includes(null))) return true;
  return Array.isArray(node.anyOf) && node.anyOf.some(branch => admitsNull(branch, root));
};
/** The one object branch of an anyOf the value can belong to: its keys all declared (additionalProperties false) and every
 * enum/const key equal. None or several: undefined (nothing is completed). */
function objectBranch(value: Record<string, unknown>, branches: unknown[], root: unknown) {
  const fits = branches.map(branch => resolveSchema(branch, root)).filter((branch): branch is Record<string, unknown> => {
    if (!record(branch) || branch.type !== "object" || !record(branch.properties)) return false;
    const properties = branch.properties;
    if (branch.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) return false;
    return Object.entries(value).every(([key, item]) => {
      const property = resolveSchema(properties[key], root);
      return !record(property) || ((!Array.isArray(property.enum) || property.enum.includes(item)) && (!("const" in property) || property.const === item));
    });
  });
  return fits.length === 1 ? fits[0] : undefined;
}
/** A list the schema requires and that does not admit null: "nothing" can only be written [] (strict decoding forces it). */
const emptyListOnly = (schema: unknown, root: unknown) => { const node = resolveSchema(schema, root); return record(node) && node.type === "array" && !admitsNull(node, root); };
/** Schema-guided completion of a non-strict answer: an omitted REQUIRED key whose schema admits null becomes null (what strict
 * decoding sends for "no value"); null or an omitted REQUIRED key where the schema only admits a list becomes [] (the same
 * "nothing": DeepSeek wrote clear_fields:null and the customer turns were refused, 04/10). Never a value; an ambiguous anyOf is
 * left as sent. */
export function completeOmittedNulls(value: unknown, schema: unknown, root: unknown): unknown {
  const node = resolveSchema(schema, root);
  if (!record(node)) return value;
  if (Array.isArray(node.anyOf)) {
    if (!record(value)) return Array.isArray(value) ? value.map(item => item) : value;
    const branch = objectBranch(value, node.anyOf, root);
    return branch ? completeOmittedNulls(value, branch, root) : value;
  }
  if (Array.isArray(value)) return node.items === undefined ? value : value.map(item => completeOmittedNulls(item, node.items, root));
  if (!record(value) || !record(node.properties)) return value;
  const out: Record<string, unknown> = { ...value }, required = Array.isArray(node.required) ? node.required : [];
  for (const [key, property] of Object.entries(node.properties)) {
    if (Object.hasOwn(out, key)) out[key] = out[key] === null && emptyListOnly(property, root) ? [] : completeOmittedNulls(out[key], property, root);
    else if (required.includes(key)) { if (admitsNull(property, root)) out[key] = null; else if (emptyListOnly(property, root)) out[key] = []; }
  }
  return out;
}
