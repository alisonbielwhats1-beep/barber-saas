import { referencesV2Enabled } from "@everflair/salon-secretary";

/** E2 (flag SALON_SECRETARY_REFERENCES_V2): closed grammatical class of the first-person forms an owner uses for their own
 * registration as a professional ("meu horário", "minha agenda", "comigo", "eu"), with an optional article: eu, mim, comigo,
 * meu, minha, meus, minhas. The object pronoun "me" and the plural "nosso/nossa" (the salon) are not in it. The whole query
 * must be one of them (never a substring: "meu" is not "Romeu", "eu" is not "Eduardo"); the catalog checks it before any name
 * search and resolves it only to the actor's own active registration in the actor's salon (scheduling-catalog.ts). */
const FIRST_PERSON = new Set(["eu", "mim", "comigo", "meu", "minha", "meus", "minhas"]);
/** FX6 (review, rule 5): the two-word forms of the same reference: a personal form with the intensifier ("eu mesma", "comigo mesmo")
 * and a possessive with an agenda head noun ("minha agenda", "meus horários"). Any other second word ("minha cliente") is not one. */
const PERSONAL = new Set(["eu", "mim", "comigo"]), INTENSIFIERS = new Set(["mesmo", "mesma", "mesmos", "mesmas"]);
const POSSESSIVES = new Set(["meu", "minha", "meus", "minhas"]), AGENDA_HEADS = new Set(["agenda", "agendas", "horario", "horarios"]);
export function isFirstPersonReference(name: string | null | undefined) {
  if (!referencesV2Enabled() || typeof name !== "string") return false;
  const words = name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/[.!?,;:]+$/u, "").trim().split(/\s+/u).filter(Boolean);
  if (words.length >= 2 && words.length <= 3 && ["o", "a", "os", "as"].includes(words[0])) words.shift();
  if (words.length === 2) return PERSONAL.has(words[0]) && INTENSIFIERS.has(words[1]) || POSSESSIVES.has(words[0]) && AGENDA_HEADS.has(words[1]);
  return words.length === 1 && FIRST_PERSON.has(words[0]);
}
