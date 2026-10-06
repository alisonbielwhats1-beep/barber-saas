import { createHash } from "node:crypto";
import namesData from "./names.json";
import { literalSpans } from "../literal-match";
import type { BankExample } from "./bank";

/** G1: the bank teaches STRUCTURE, never names. Every person and service of an entry is a placeholder in its message,
 * state, values and literals: {cliente}, {cliente2}, {profissional}, {servico}... A lowercase token renders as typed on
 * a phone (lowercase, no accents); a capitalized one ({Cliente}) as the backend writes it. Parts: {x.nome} and
 * {x.sobrenome} of a `full` slot, {x.formal} (the formal given name) of a `nickname` slot. The entry declares each
 * person slot's grammatical gender (articles and pronouns agree) and form in `slots`.
 * At render time the tokens are filled from a compact fictional list (names.json), deterministically per seed: people
 * never share a word with the current salon's team, with each other or with the entry's own text; services come from the
 * current salon's directory when it publishes one (they are already in Luna's context), else from a generic list. */
export const EXAMPLE_NAMES_FILE = "packages/salon-secretary/src/examples/names.json";
/** Seed of the canonical fill: what eligibility, the gate and evaluation render when no request is involved. */
export const CANONICAL_FILL_SEED = "canonical";
/** Generic services (the ones the bank used before G1), only when the salon publishes none. */
export const GENERIC_EXAMPLE_SERVICES = ["Corte", "Escova", "Hidratação", "Coloração", "Luzes", "Progressiva", "Manicure", "Pedicure", "Barba", "Sobrancelha",
  "Pigmentação", "Unha em gel", "Corte masculino", "Mão e pé"] as const;
export type SlotGender = "f" | "m" | "u";
export type SlotForm = "first" | "full" | "nickname";
export type ExampleSlot = { gender: SlotGender; form?: SlotForm };
export type PersonFill = { given: string; surname?: string; nickname?: string; formal?: string };
export type ExampleFills = { people: Record<string, PersonFill>; services: Record<string, string> };
export type ExampleDirectory = { professionals?: readonly string[]; services?: readonly string[] };
type NamesFile = { given: Record<SlotGender, string[]>; nicknames: { name: string; formal?: string; gender: SlotGender }[]; surnames: string[]; services: string[] };
const names = namesData as unknown as NamesFile;

/** {cliente}, {Cliente2}, {profissional.nome}, {servico}... (the first letter's case is the rendering style). */
export const PLACEHOLDER = /\{([cC]liente|[pP]rofissional|[sS]ervico)([2-9]?)(?:\.(nome|sobrenome|formal))?\}/g;
/** Anything that still looks like a placeholder after filling (a typo in the bank, an undeclared part). */
const LEFTOVER = /\{[^{}\s"]{1,40}\}/;
export const PERSON_SLOT = /^(?:cliente|profissional)[2-9]?$/;
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").toLocaleLowerCase("pt-BR");
const words = (text: string) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Keys whose strings are structure (never text with names). */
const STRUCTURE = new Set(["id", "clock", "source", "tags", "item_key", "operation", "requested_field", "kind", "mode", "unavailable_capability", "requires", "depends_on",
  "released_slot_of", "field", "legacy", "components", "daypart", "slots"]);
function strings(value: unknown, key = "", out: string[] = []): string[] {
  if (STRUCTURE.has(key)) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach(item => strings(item, "", out));
  else if (value && typeof value === "object") for (const [k, item] of Object.entries(value)) strings(item, k, out);
  return out;
}
type Token = { slot: string; part?: "nome" | "sobrenome" | "formal"; upper: boolean };
/** Every placeholder an entry uses (slot names lowercase). */
export function examplePlaceholders(example: BankExample): Token[] {
  return strings(example).flatMap(text => [...text.matchAll(PLACEHOLDER)].map(m => ({ slot: m[1].toLowerCase() + m[2], ...(m[3] ? { part: m[3] as Token["part"] } : {}), upper: m[1][0] !== m[1][0].toLowerCase() })));
}
const slotsOf = (example: BankExample): Record<string, ExampleSlot> => (example as { slots?: Record<string, ExampleSlot> }).slots ?? {};
/** Placeholder consistency (codes only): every person token declared, every declared slot used, parts valid for the form. */
export function placeholderIssues(example: BankExample): string[] {
  const out = new Set<string>(), slots = slotsOf(example), used = examplePlaceholders(example);
  for (const token of used) {
    if (token.slot.startsWith("servico")) { if (token.part) out.add("SERVICE_PART"); continue; }
    const slot = slots[token.slot];
    if (!slot) { out.add("SLOT_UNDECLARED"); continue; }
    const form = slot.form ?? "first";
    if (token.part === "formal" && form !== "nickname" || (token.part === "nome" || token.part === "sobrenome") && form !== "full") out.add("PART_FORM_MISMATCH");
  }
  for (const slot of Object.keys(slots)) if (!PERSON_SLOT.test(slot)) out.add("SLOT_NAME"); else if (!used.some(token => token.slot === slot)) out.add("SLOT_UNUSED");
  // A slot a lowercase token never names would only appear capitalized: fine. A service slot never needs a declaration.
  if (strings(example).some(text => LEFTOVER.test(text.replace(PLACEHOLDER, "")))) out.add("PLACEHOLDER_MALFORMED");
  return [...out];
}

function tokenText(token: Token, fills: ExampleFills, slots: Record<string, ExampleSlot>) {
  let text: string | undefined;
  if (token.slot.startsWith("servico")) text = fills.services[token.slot];
  else {
    const person = fills.people[token.slot], form = slots[token.slot]?.form ?? "first";
    if (person) text = token.part === "nome" ? person.given : token.part === "sobrenome" ? person.surname : token.part === "formal" ? person.formal
      : form === "nickname" ? person.nickname : form === "full" ? `${person.given} ${person.surname}` : person.given;
  }
  if (!text) throw Error("EXAMPLE_FILL_MISSING");
  // Typed style: lowercase without accents ("julia"); the backend's style keeps the canonical spelling.
  return token.upper ? text : fold(text);
}
/** The entry with every placeholder replaced (values, literals, message, state, reply) and without its `slots`
 * declaration (a filled entry is an ordinary one). Pure; throws on a missing fill. */
export function fillExample(example: BankExample, fills: ExampleFills): BankExample {
  const slots = slotsOf(example);
  const swap = (text: string) => text.replace(PLACEHOLDER, (_all, role: string, n: string, part?: string) =>
    tokenText({ slot: role.toLowerCase() + n, ...(part ? { part: part as Token["part"] } : {}), upper: role[0] !== role[0].toLowerCase() }, fills, slots));
  const rewrite = (value: unknown, key = ""): unknown => STRUCTURE.has(key) ? value : typeof value === "string" ? swap(value) : Array.isArray(value) ? value.map(item => rewrite(item))
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, k)])) : value;
  const { slots: _declared, ...entry } = example as BankExample & { slots?: unknown };void _declared;
  return rewrite(entry) as BankExample;
}

const hash32 = (value: string) => { let h = 0x811c9dc5; for (const byte of Buffer.from(value, "utf8")) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled<T>(items: readonly T[], rng: () => number) { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }
const givenPool = (gender: SlotGender, rng: () => number) => gender === "u" ? [...shuffled(names.given.u, rng), ...shuffled([...names.given.f, ...names.given.m], rng)]
  : [...shuffled(names.given[gender], rng), ...shuffled(names.given.u, rng)];
/** Literals still quote exactly one span of the filled message (a fill never duplicates or hides a quote). */
function literalsExact(example: BankExample) {
  const quotes: string[] = [];
  const visit = (value: unknown, key = "") => {
    if (key === "source_scope" || key === "same_as") return;
    if (Array.isArray(value)) value.forEach(item => visit(item));
    else if (value && typeof value === "object") for (const [k, item] of Object.entries(value)) { if (k === "literal" && typeof item === "string") quotes.push(item); else visit(item, k); }
  };
  example.expected.operations.forEach(op => visit(op));
  return quotes.every(quote => literalSpans(example.message, quote).length === 1);
}
/** The directory identity that seeds a salon-stable fill (full mode keeps a stable instruction prefix per salon). */
export const directorySeed = (directory?: ExampleDirectory) => directory ? createHash("sha256").update(JSON.stringify([[...directory.professionals ?? []].sort(), [...directory.services ?? []].sort()])).digest("hex").slice(0, 16) : "";
/** Deterministic fills for one entry: seeded by (seed, entry id), so the same request is stable and different entries
 * get different names. Undefined when no candidate keeps every literal exact (the entry is then not served). */
export function exampleFills(example: BankExample, seed: string, directory?: ExampleDirectory): ExampleFills | undefined {
  const tokens = examplePlaceholders(example), slots = slotsOf(example);
  const serviceSlots = [...new Set(tokens.filter(token => token.slot.startsWith("servico")).map(token => token.slot))].sort();
  const personSlots = Object.keys(slots).sort();
  if (!serviceSlots.length && !personSlots.length) return { people: {}, services: {} };
  // Words the fills must avoid: the entry's own text outside placeholders and the salon's professionals (Luna must never
  // see an example that names someone of the current team).
  const fixed = new Set(strings(example).flatMap(text => words(text.replace(PLACEHOLDER, " "))));
  const team = new Set((directory?.professionals ?? []).flatMap(words));
  const services = directory?.services?.length ? [...new Set(directory.services)] : [...names.services];
  const rng = mulberry32(hash32(`${seed}|${example.id}`));
  for (let attempt = 0; attempt < 4; attempt++) {
    const used = new Set([...fixed, ...team]), free = (text: string) => { const w = words(text); return w.length > 0 && w.every(x => !used.has(x)); };
    const take = (text: string) => { for (const w of words(text)) used.add(w); return text; };
    const people: Record<string, PersonFill> = {}, chosen: Record<string, string> = {};
    let complete = true;
    for (const slot of personSlots) {
      const { gender, form = "first" } = slots[slot];
      if (form === "nickname") {
        // A gendered slot prefers its gender's nicknames, then unisex ones; the formal name is needed only when shown.
        const shows = tokens.some(token => token.slot === slot && token.part === "formal");
        const pool = [...shuffled(names.nicknames.filter(n => n.gender === gender), rng), ...shuffled(names.nicknames.filter(n => n.gender !== gender && (gender === "u" || n.gender === "u")), rng)];
        const nick = pool.find(n => free(n.name) && (n.formal ? free(n.formal) && words(n.name)[0] !== words(n.formal)[0] : !shows));
        if (!nick) { complete = false; break; }
        people[slot] = { given: nick.formal ?? nick.name, nickname: take(nick.name), ...(nick.formal ? { formal: take(nick.formal) } : {}) };
      } else {
        const given = givenPool(gender, rng).find(free);
        if (!given) { complete = false; break; }
        take(given);
        if (form === "full") {
          const surname = shuffled(names.surnames, rng).find(free);
          if (!surname) { complete = false; break; }
          people[slot] = { given, surname: take(surname) };
        } else people[slot] = { given };
      }
    }
    for (const slot of serviceSlots) {
      if (!complete) break;
      const service = shuffled(services, rng).find(free);
      if (!service) { complete = false; break; }
      chosen[slot] = take(service);
    }
    if (!complete) continue;
    const fills = { people, services: chosen };
    try { if (literalsExact(fillExample(example, fills))) return fills; } catch { /* retried below */ }
  }
  return undefined;
}
/** Every word the fill list may show (people and generic services): evaluation masks them as names or reports them. */
export const exampleFillNames = () => ({ people: [...names.given.f, ...names.given.m, ...names.given.u, ...names.nicknames.flatMap(n => n.formal ? [n.name, n.formal] : [n.name]), ...names.surnames],
  services: [...names.services] });
