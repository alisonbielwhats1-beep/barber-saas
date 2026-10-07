import { existsSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { listSchedulingServices, servicePickGuardEnabled } from "../scheduling-catalog";
import { suggestSchedulingServices } from "../entity-suggestions";
import { phoneticNamesEnabled, sameName, samePhoneticName } from "../name-search";
import { serviceSwapV2Enabled } from "../scheduling-temporal-source";
import { BANK_CASES as PUBLIC_CASES, BANK_CATALOGS as PUBLIC_CATALOGS, type BankCase, type BankCatalog } from "./fixtures/service-name-bank";

// The real catalogs whose names are not in the public code live only on the owner's machine (git-ignored); measured when present.
type LocalBank = { BANK_LOCAL_CATALOGS: readonly BankCatalog[]; BANK_LOCAL_CASES: readonly BankCase[] };
const localFile = new URL("./fixtures/service-name-bank.local.ts", import.meta.url);
const local: LocalBank | undefined = existsSync(localFile) ? await import(/* @vite-ignore */ localFile.href) : undefined;
const BANK_CATALOGS: readonly BankCatalog[] = [...PUBLIC_CATALOGS, ...(local?.BANK_LOCAL_CATALOGS ?? [])];
const BANK_CASES: readonly BankCase[] = [...PUBLIC_CASES, ...(local?.BANK_LOCAL_CASES ?? [])];

/** Owner 07/10/2026: medição dos nomes de serviço (fase 0). Cada frase do banco passa pela busca real do serviço
 * (listSchedulingServices) e, se nada for achado, pelas sugestões reais (suggestSchedulingServices), com a mesma decisão do
 * fluxo da secretária (secretary-scheduling.ts: nome exato, um resultado escolhido, 2-20 viram card, sugestão, nada).
 * Fora da medição: o modelo (a frase já é o service_name), combos de vários serviços, apelidos aprendidos.
 * SERVICE_BANK_REPORT=<arquivo.md> grava o relatório. */
type Row = { id: string; name: string; category: string | null };
type Outcome = { kind: "AUTO"; id: string } | { kind: "LIST" | "SUGGEST"; ids: string[] } | { kind: "NONE" | "DETAIL" | "TOO_MANY" };
type Verdict = "direto" | "lista" | "direto-ambiguo" | "erro-sozinho" | "nao-achou" | "certo-nada" | "lista-indevida";

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const byName = (a: Row, b: Row) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
function fakeTx(rows: readonly Row[]) {
  const project = (row: Row, select: Record<string, unknown>) => ({ id: row.id, name: row.name, durationMin: 60, priceCents: 5000, priceType: "FIXED",
    ...(select.category ? { category: row.category } : {}) });
  return {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("accessStatus")) return [{ accessStatus: "APPROVED" }];
      if (sql.includes("Membership")) return [{ role: "OWNER" }];
      const pattern = values.find((value): value is string => typeof value === "string" && value.startsWith("%") && value.endsWith("%"));
      if (!pattern) throw Error(`unexpected query: ${sql}`);
      const term = fold(pattern.slice(1, -1).replace(/\\(.)/g, "$1"));
      return [...rows].sort(byName).filter(row => fold(row.name).includes(term)).slice(0, 21).map(row => ({ id: row.id }));
    }),
    service: { findMany: vi.fn(async (args: { where: { name?: { contains: string }; OR?: { name?: { contains: string }; id?: { in: string[] } }[] }; select: Record<string, unknown>; take?: number }) => {
      const said = args.where.name ?? args.where.OR?.[0]?.name, ids = args.where.OR?.[1]?.id?.in ?? [];
      // Prisma `contains` with mode insensitive is ILIKE: case aside, accents kept.
      return [...rows].sort(byName).filter(row => !said || row.name.toLowerCase().includes(said.contains.toLowerCase()) || ids.includes(row.id))
        .slice(0, args.take ?? Infinity).map(row => project(row, args.select));
    }) },
  } as unknown as Tx;
}
const actor = { salonId: "salon-bank", userId: "owner-bank" };

/** The secretary's service decision for one service_name (secretary-scheduling.ts, the service_ref branch). */
async function resolve(tx: Tx, said: string): Promise<Outcome> {
  const rows = await listSchedulingServices(tx, actor, said);
  const exact = rows.length > 1 && serviceSwapV2Enabled() ? rows.filter(row => sameName(row.name, said)) : [];
  if (exact.length === 1) return { kind: "AUTO", id: exact[0].id };
  if (rows.length === 1) return { kind: "AUTO", id: rows[0].id };
  if (rows.length > 20) return { kind: "TOO_MANY" };
  if (rows.length) return { kind: "LIST", ids: rows.map(row => row.id) };
  const found = await suggestSchedulingServices(tx, actor, said);
  if (found.status === "SUGGEST") {
    const sound = phoneticNamesEnabled() ? found.rows.filter(row => samePhoneticName(said, row.name) && (!servicePickGuardEnabled() || samePhoneticName(row.name, said))) : [];
    return sound.length === 1 ? { kind: "AUTO", id: sound[0].id } : { kind: "SUGGEST", ids: found.rows.map(row => row.id) };
  }
  return { kind: found.status === "NONE" ? "NONE" : "DETAIL" };
}
function judge(item: BankCase, outcome: Outcome): Verdict {
  const want = new Set(item.want ?? []);
  if (item.expect === "none") return outcome.kind === "AUTO" ? "erro-sozinho" : outcome.kind === "LIST" || outcome.kind === "SUGGEST" ? "lista-indevida" : "certo-nada";
  if (outcome.kind === "AUTO") return !want.has(outcome.id) ? "erro-sozinho" : item.expect === "one" ? "direto" : "direto-ambiguo";
  if ((outcome.kind === "LIST" || outcome.kind === "SUGGEST") && outcome.ids.some(id => want.has(id))) return "lista";
  return "nao-achou";
}

const PROFILES = [
  { key: "certificado", label: "Certificado (sugestões)", env: { SALON_SECRETARY_NAME_SUGGESTIONS: "true" } },
  { key: "certificado+abrev", label: "Certificado + abreviação", env: { SALON_SECRETARY_NAME_SUGGESTIONS: "true", SALON_SECRETARY_SERVICE_ABBREVIATIONS: "true" } },
  { key: "demo", label: "Demo (+ nome exato, som)", env: { SALON_SECRETARY_NAME_SUGGESTIONS: "true", SALON_SECRETARY_SERVICE_SWAP_V2: "true", SALON_SECRETARY_PHONETIC_NAMES: "true" } },
  { key: "demo+abrev", label: "Demo + abreviação", env: { SALON_SECRETARY_NAME_SUGGESTIONS: "true", SALON_SECRETARY_SERVICE_SWAP_V2: "true", SALON_SECRETARY_PHONETIC_NAMES: "true", SALON_SECRETARY_SERVICE_ABBREVIATIONS: "true" } },
  { key: "certificado+abrev+trava", label: "Certificado + abreviação + trava", env: { SALON_SECRETARY_NAME_SUGGESTIONS: "true", SALON_SECRETARY_SERVICE_ABBREVIATIONS: "true", SALON_SECRETARY_SERVICE_PICK_GUARD: "true" } },
  { key: "demo+abrev+trava", label: "Demo + abreviação + trava", env: { SALON_SECRETARY_NAME_SUGGESTIONS: "true", SALON_SECRETARY_SERVICE_SWAP_V2: "true", SALON_SECRETARY_PHONETIC_NAMES: "true", SALON_SECRETARY_SERVICE_ABBREVIATIONS: "true", SALON_SECRETARY_SERVICE_PICK_GUARD: "true" } },
] as const;
const results = new Map<string, { item: BankCase; outcome: Outcome; verdict: Verdict }[]>();
const catalogs = new Map(BANK_CATALOGS.map(catalog => [catalog.key, catalog.services.map(([name, category]) => ({ id: name, name, category }))]));

afterEach(() => { vi.unstubAllEnvs(); });

describe("banco de variações de nomes de serviço", () => {
  it("every case names real services of its catalog", () => {
    for (const item of BANK_CASES) {
      const names = new Set(catalogs.get(item.catalog)?.map(row => row.name));
      expect(names.size, item.catalog).toBeGreaterThan(0);
      for (const want of item.want ?? []) expect(names.has(want), `${item.catalog}: ${want}`).toBe(true);
    }
  });
  for (const profile of PROFILES) it(`measures ${profile.label}`, async () => {
    for (const [name, value] of Object.entries(profile.env)) vi.stubEnv(name, value);
    const rows = [];
    for (const item of BANK_CASES) {
      const outcome = await resolve(fakeTx(catalogs.get(item.catalog)!), item.said);
      rows.push({ item, outcome, verdict: judge(item, outcome) });
    }
    results.set(profile.key, rows);
  });
  it("with the pick guard, no service is ever taken alone wrongly, and nothing found before is lost", () => {
    for (const [before, after] of [["certificado+abrev", "certificado+abrev+trava"], ["demo+abrev", "demo+abrev+trava"]] as const) {
      const guarded = results.get(after)!, plain = results.get(before)!;
      expect(guarded.filter(row => row.verdict === "erro-sozinho").map(row => `${row.item.catalog}: ${row.item.said}`)).toEqual([]);
      const found = (rows: typeof guarded) => rows.filter(row => ["direto", "lista", "direto-ambiguo"].includes(row.verdict)).length;
      expect(found(guarded)).toBeGreaterThanOrEqual(found(plain));
    }
  });
});

const show = (outcome: Outcome) => outcome.kind === "AUTO" ? `escolhe “${outcome.id}”` : outcome.kind === "LIST" ? `lista (${outcome.ids.length})` :
  outcome.kind === "SUGGEST" ? `sugere (${outcome.ids.length})` : outcome.kind === "NONE" ? "não achou" : outcome.kind === "DETAIL" ? "pede detalhe" : "muitas opções";
afterAll(() => {
  if (results.size !== PROFILES.length) return;
  const lines: string[] = [];
  const findable = BANK_CASES.filter(item => item.expect !== "none").length, absent = BANK_CASES.length - findable;
  lines.push(`Frases: ${BANK_CASES.length} (${findable} de serviços que existem, ${absent} de serviços que o salão não tem); cardápios: ${BANK_CATALOGS.length}${local ? " (com os locais)" : " (só os públicos)"}`, "");
  lines.push("| Perfil | Achou | Direto certo | Só em lista | Não achou | Escolheu errado sozinho | 'Não tem' certo | Lista indevida |", "|---|---|---|---|---|---|---|---|");
  for (const profile of PROFILES) {
    const rows = results.get(profile.key)!, count = (...verdicts: Verdict[]) => rows.filter(row => verdicts.includes(row.verdict)).length;
    const found = count("direto", "lista", "direto-ambiguo");
    lines.push(`| ${profile.label} | ${found}/${findable} (${Math.round(found / findable * 100)}%) | ${count("direto")} | ${count("lista", "direto-ambiguo")} | ${count("nao-achou")} | ${count("erro-sozinho")} | ${count("certo-nada")}/${absent} | ${count("lista-indevida")} |`);
  }
  for (const profile of [PROFILES[3], PROFILES[5]]) {
    lines.push("", `### ${profile.label}: falhas`, "", "| Cardápio | Dono diz | Esperado | Resultado | Tipo |", "|---|---|---|---|---|");
    for (const row of results.get(profile.key)!.filter(row => ["erro-sozinho", "nao-achou", "lista-indevida"].includes(row.verdict)))
      lines.push(`| ${row.item.catalog} | ${row.item.said} | ${row.item.expect === "none" ? "nada" : row.item.want!.join(" / ")} | ${show(row.outcome)} | ${row.verdict === "erro-sozinho" ? "**ERRO SOZINHO**" : row.verdict}${row.item.note ? ` (${row.item.note})` : ""} |`);
  }
  for (const [before, after] of [[PROFILES[1], PROFILES[4]], [PROFILES[3], PROFILES[5]]] as const) {
    const was = results.get(before.key)!, now = results.get(after.key)!;
    lines.push("", `### O que mudou de “${before.label}” para “${after.label}”`, "", "| Cardápio | Dono diz | Antes | Depois |", "|---|---|---|---|");
    now.forEach((row, index) => { if (show(row.outcome) !== show(was[index].outcome)) lines.push(`| ${row.item.catalog} | ${row.item.said} | ${show(was[index].outcome)} | ${show(row.outcome)} |`); });
  }
  const report = lines.join("\n");
  if (process.env.SERVICE_BANK_REPORT) writeFileSync(process.env.SERVICE_BANK_REPORT, `${report}\n`, "utf8");
  else console.log(report);
});
