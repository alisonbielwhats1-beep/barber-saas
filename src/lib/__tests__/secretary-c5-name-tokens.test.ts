import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 (flag SALON_SECRETARY_WHOLE_NAME_MATCH, default off; V4 MV01, MV20, MV25): a person search matches a registered name only when
 * every token of the query is a whole token of it (case, accents and particles aside; hyphens split; any order). A part of a token
 * is never a match ("Nara" is not "Tainara"). Customers (esmalteria) and professionals (spa) through the real catalog functions and
 * the real customer adapter, with a fake tenant transaction that evaluates the prefilter the way PostgreSQL would (translate +
 * lower, substring). Diverse synthetic names; no gender inferred from a name. No DB, no network, no model, no write. */
type Customer = { id: string; salonId: string; name: string; phone: string | null; phoneNormalized: string | null; email: string | null; mergedIntoId: string | null };
type Pro = { id: string; salonId: string; name: string; active: boolean };
type Filter = { in?: string[]; contains?: string; equals?: string };
type ProName = { user?: { name: { contains: string } }; id?: { in: string[] } };
const db = vi.hoisted(() => ({ tx: undefined as unknown, customers: [] as Customer[], pros: [] as Pro[], sql: [] as { sql: string; values: unknown[] }[],
  customerQueries: [] as unknown[], proQueries: [] as unknown[], write: vi.fn() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, work: (tx: unknown) => unknown) => work(db.tx) }));
vi.mock("../customer-actions", () => ({ upsertCustomerDraft: db.write, proposeCustomerChange: db.write, confirmCustomerChange: db.write }));
import { FOLD_FROM, FOLD_TO } from "../name-search";
import { searchSalonCustomer } from "../customer-catalog";
import { listSchedulingProfessionals } from "../scheduling-catalog";
import { NAME_TOKEN_SCAN, nameHasTokens, nameTokenQuery, nameTokensEnabled, tokenMatchedIds } from "../secretary-name-tokens";
import { applyCustomerInterpretation, customerState, selectCustomer } from "../secretary-customers";

const FLAG = "SALON_SECRETARY_WHOLE_NAME_MATCH";
const actor = { salonId: "ours", userId: "owner" };
/** The historical statements (flag off), exactly as the catalogs send them (parameters as "?"). */
const HISTORICAL_CUSTOMER_SQL = `SELECT id FROM "ClientProfile" WHERE "salonId"=? AND "mergedIntoId" IS NULL AND lower(translate(name, ?, ?)) LIKE lower(translate(?, ?, ?)) ESCAPE '\\' ORDER BY name, id LIMIT 21`;
const HISTORICAL_PROFESSIONAL_SQL = `SELECT p.id FROM "Professional" p JOIN "User" u ON u.id=p."userId" WHERE p."salonId"=? AND p.active AND lower(translate(u.name, ?, ?)) LIKE lower(translate(?, ?, ?)) ESCAPE '\\' ORDER BY p.id LIMIT 21`;
/** PostgreSQL's folding in these statements: translate with the fixed table, then lower (accents outside the table are kept). */
const sqlFold = (text: string) => [...text].map(ch => { const at = FOLD_FROM.indexOf(ch); return at < 0 ? ch : FOLD_TO[at]; }).join("").toLowerCase();
const like = (name: string, pattern: string) => sqlFold(name).includes(sqlFold(pattern.slice(1, -1).replace(/\\(.)/g, "$1")));
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => order(a.name, b.name) || order(a.id, b.id);
const matches = (row: Customer, q: Record<string, Filter>) => Object.entries(q).every(([field, f]) => {
  const value = (row as unknown as Record<string, string | null>)[field];
  return f.in ? f.in.includes(value as string) : f.contains !== undefined ? !!value && value.toLowerCase().includes(f.contains.toLowerCase())
    : f.equals !== undefined ? !!value && value.toLowerCase() === f.equals.toLowerCase() : false;
});
const proName = (row: Pro, q: ProName) => q.id ? q.id.in.includes(row.id) : !!q.user && row.name.toLowerCase().includes(q.user.name.contains.toLowerCase());
const customer = (id: string, name: string, extra: Partial<Customer> = {}): Customer => ({ id, salonId: "ours", name, phone: null, phoneNormalized: null, email: null, mergedIntoId: null, ...extra });
const ids = (rows: readonly { id: string }[]) => rows.map(row => row.id);
const tokenStatements = () => db.sql.filter(entry => entry.sql.includes("unnest("));
const statements = () => db.sql.map(entry => entry.sql);

beforeEach(() => {
  vi.clearAllMocks(); db.sql.length = 0; db.customerQueries.length = 0; db.proQueries.length = 0;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  vi.stubEnv(FLAG, "false"); vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", "false");
  db.customers = [customer("c-nara", "Nara Uchoa", { phone: "11988887701", phoneNormalized: "11988887701" }),
    customer("c-tainara", "Tainara Bezerra", { phone: "11988887702", phoneNormalized: "11988887702", email: "tainara.b@example.test" }),
    customer("c-ana", "Ana Paula Viana"), customer("c-mariana", "Mariana Okafor"), customer("c-anabela", "Anabela Reis"),
    customer("c-heejin", "Hee-Jin Park"), customer("c-anne", "Anne-Sophie Moreau"), customer("c-icaro", "Ícaro Mendes"), customer("c-iolanda", "Iolanda da Cunha"),
    customer("c-merged", "Nara Lins", { mergedIntoId: "c-nara" }), customer("f-nara", "Nara Tavares", { salonId: "theirs" })];
  db.pros = [{ id: "p-ana", salonId: "ours", name: "Ana Beatriz Kowalski", active: true }, { id: "p-heejin", salonId: "ours", name: "Hee-Jin Choi", active: true },
    { id: "p-luana", salonId: "ours", name: "Luana Ferraz", active: true }, { id: "p-mariana", salonId: "ours", name: "Mariana Duarte", active: true },
    { id: "p-off", salonId: "ours", name: "Ana Clara Nunes", active: false }, { id: "p-theirs", salonId: "theirs", name: "Ana Sato", active: true }];
  db.tx = {
    $queryRaw: vi.fn(async (parts: readonly string[], ...values: unknown[]) => {
      const sql = parts.join("?"); db.sql.push({ sql, values });
      if (sql.includes('"Membership"')) return [{ role: "OWNER" }];
      if (sql.includes('"Salon"')) return [{ accessStatus: "APPROVED" }];
      const salonId = values[0], patterns = values.find(Array.isArray) as string[] | undefined, limit = Number(values[values.length - 1]);
      if (sql.includes('"ClientProfile"')) {
        const rows = db.customers.filter(row => row.salonId === salonId && !row.mergedIntoId).sort(byName);
        return patterns ? rows.filter(row => patterns.every(p => like(row.name, p))).slice(0, limit).map(({ id, name }) => ({ id, name }))
          : rows.filter(row => like(row.name, values[3] as string)).slice(0, 21).map(({ id }) => ({ id }));
      }
      if (sql.includes('"Professional"')) {
        const rows = db.pros.filter(row => row.salonId === salonId && row.active).sort((a, b) => order(a.id, b.id));
        return patterns ? rows.filter(row => patterns.every(p => like(row.name, p))).slice(0, limit).map(({ id, name }) => ({ id, name }))
          : rows.filter(row => like(row.name, values[3] as string)).slice(0, 21).map(({ id }) => ({ id }));
      }
      return [];
    }),
    clientProfile: {
      findMany: vi.fn(async (args: { where: { salonId: string; mergedIntoId: null; OR: Record<string, Filter>[] }; take: number }) => {
        db.customerQueries.push(args); const { where } = args;
        return db.customers.filter(row => row.salonId === where.salonId && row.mergedIntoId === where.mergedIntoId && where.OR.some(q => matches(row, q)))
          .sort(byName).slice(0, args.take).map(({ id, name, phone }) => ({ id, name, phone }));
      }),
      findFirst: vi.fn(async ({ where, select }: { where: { id: string; salonId: string; mergedIntoId: null }; select: Record<string, boolean> }) => {
        const row = db.customers.find(r => r.id === where.id && r.salonId === where.salonId && r.mergedIntoId === where.mergedIntoId);
        return row ? Object.fromEntries(Object.entries(row).filter(([key]) => select[key])) : null;
      }),
    },
    professional: {
      findMany: vi.fn(async (args: { where: { salonId: string; active: boolean; id?: { in: string[] }; user?: ProName["user"]; OR?: ProName[] }; take: number }) => {
        db.proQueries.push(args); const { where } = args;
        return db.pros.filter(row => row.salonId === where.salonId && row.active === where.active && (!where.id || where.id.in.includes(row.id))
          && (!where.user || proName(row, { user: where.user })) && (!where.OR || where.OR.some(q => proName(row, q))))
          .sort((a, b) => order(a.id, b.id)).slice(0, args.take).map(row => ({ id: row.id, user: { name: row.name } }));
      }),
    },
  };
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.write).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const search = async (query: string) => ids(await searchSalonCustomer(db.tx as Tx, actor, query));
const pros = async (query?: string) => ids(await listSchedulingProfessionals(db.tx as Tx, actor, query === undefined ? {} : { query }));

describe("whole name tokens (pure)", () => {
  it("folds case and accents, splits hyphens and punctuation, drops particles and keeps each written token for the prefilter", () => {
    expect(nameTokenQuery("Hee-Jin")).toEqual({ tokens: ["hee", "jin"], patterns: ["%Hee%", "%Jin%"] });
    expect(nameTokenQuery("anne sophie")).toEqual({ tokens: ["anne", "sophie"], patterns: ["%anne%", "%sophie%"] });
    expect(nameTokenQuery("  Iolanda da Cunha ")).toEqual({ tokens: ["iolanda", "cunha"], patterns: ["%Iolanda%", "%Cunha%"] });
    expect(nameTokenQuery("ÍCARO")).toEqual({ tokens: ["icaro"], patterns: ["%ÍCARO%"] });
    expect(nameTokenQuery("Nara nara NARA").tokens).toEqual(["nara"]);
  });
  it("a part of a token is never a match: Nara is not Tainara; Ana is neither Mariana nor Anabela", () => {
    expect(nameHasTokens(["nara"], "Tainara Bezerra")).toBe(false);
    expect(nameHasTokens(["nara"], "Nara Uchoa")).toBe(true);
    expect(nameHasTokens(["nara"], "Kenji Nara")).toBe(true);
    expect(nameHasTokens(["ana"], "Mariana Okafor")).toBe(false);
    expect(nameHasTokens(["ana"], "Anabela Reis")).toBe(false);
    expect(nameHasTokens(["ana"], "Ana Paula Viana")).toBe(true);
    expect(nameHasTokens(["soph"], "Anne-Sophie Moreau")).toBe(false);
    expect(nameHasTokens(["heejin"], "Hee-Jin Park")).toBe(false); // two registered tokens are never one said token
  });
  it("every query token must be a whole token, in any order, with hyphens, accents and particles aside", () => {
    expect(nameHasTokens(nameTokenQuery("paula ana").tokens, "Ana Paula Viana")).toBe(true);
    expect(nameHasTokens(nameTokenQuery("Ana Paulina").tokens, "Ana Paula Viana")).toBe(false);
    expect(nameHasTokens(nameTokenQuery("hee jin").tokens, "Hee-Jin Park")).toBe(true);
    expect(nameHasTokens(nameTokenQuery("anne sophie").tokens, "Anne-Sophie Moreau")).toBe(true);
    expect(nameHasTokens(nameTokenQuery("anne").tokens, "Anne-Sophie Moreau")).toBe(true);
    expect(nameHasTokens(nameTokenQuery("icaro").tokens, "Ícaro Mendes")).toBe(true);
    expect(nameHasTokens(nameTokenQuery("INES").tokens, "Inês Duarte")).toBe(true);
    expect(nameHasTokens(nameTokenQuery("Iolanda Cunha").tokens, "Iolanda da Cunha")).toBe(true);
  });
  it("fails safe: no tokens, no name, a non-list or an overflowing prefilter never decide", () => {
    expect(nameTokenQuery("de da do")).toEqual({ tokens: [], patterns: [] });
    expect(nameHasTokens([], "Nara Uchoa")).toBe(false);
    expect(nameHasTokens(["nara"], null)).toBe(false);
    expect(nameHasTokens(["nara"], 42)).toBe(false);
    expect(tokenMatchedIds(["nara"], null)).toBeUndefined();
    expect(tokenMatchedIds(["nara"], { id: "x", name: "Nara" })).toBeUndefined();
    const three = [{ id: "a", name: "Nara A" }, { id: "b", name: "Nara B" }, { id: "c", name: "Nara C" }];
    expect(tokenMatchedIds(["nara"], three, 2)).toBeUndefined();
    expect(tokenMatchedIds(["nara"], three, 3)).toEqual(["a", "b", "c"]);
    expect(tokenMatchedIds(["nara"], [null, { id: 1, name: "Nara" }, { id: "x" }, { id: "y", name: "Tainara" }, { id: "z", name: "Nara Z" }])).toEqual(["z"]);
    const scan = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: "Nara Uchoa" }));
    expect(tokenMatchedIds(["nara"], scan(NAME_TOKEN_SCAN))).toHaveLength(NAME_TOKEN_SCAN);
    expect(tokenMatchedIds(["nara"], scan(NAME_TOKEN_SCAN + 1))).toBeUndefined();
  });
  it("LIKE wildcards typed by the owner are separators, never wildcards; combining marks stay inside their token", () => {
    const typed = nameTokenQuery("Na%ra_b\\");
    expect(typed).toEqual({ tokens: ["na", "ra", "b"], patterns: ["%Na%", "%ra%", "%b%"] });
    expect(typed.patterns.every(p => !/[%_\\]/.test(p.slice(1, -1)))).toBe(true);
    expect(nameTokenQuery("Ax\u0301el Brandt").tokens).toEqual(["axel", "brandt"]); // no precomposed form: the mark is not a split
    expect(nameTokenQuery("Ine\u0302s").patterns).toEqual(["%In\u00eas%"]); // decomposed input reaches SQL composed (NFC)
  });
  it("the flag is on only for the exact string 'true'", () => {
    for (const value of ["TRUE", "1", "on", "yes", ""]) { vi.stubEnv(FLAG, value); expect(nameTokensEnabled()).toBe(false); }
    delete process.env[FLAG]; expect(nameTokensEnabled()).toBe(false);
    vi.stubEnv(FLAG, "true"); expect(nameTokensEnabled()).toBe(true);
  });
});

describe("customer search with SALON_SECRETARY_WHOLE_NAME_MATCH on", () => {
  beforeEach(() => { vi.stubEnv(FLAG, "true"); });
  it("'Nara' finds only Nara Uchoa: never Tainara, a merged profile or another salon's Nara", async () => {
    for (const query of ["Nara", "nara", "NARA", "a Nara"]) expect(await search(query)).toEqual(["c-nara"]);
    const [statement] = tokenStatements();
    expect(statement.sql).toContain('FROM "ClientProfile" WHERE "salonId"=? AND "mergedIntoId" IS NULL AND NOT EXISTS (SELECT 1 FROM unnest(?::text[])');
    expect(statement.values[0]).toBe("ours"); expect(statement.values[1]).toEqual(["%Nara%"]); expect(statement.values.at(-1)).toBe(NAME_TOKEN_SCAN + 1);
    expect(statements()).not.toContain(HISTORICAL_CUSTOMER_SQL);
    expect(await search("Tainara")).toEqual(["c-tainara"]);
    expect(await search("Tai")).toEqual([]);
  });
  it("'Ana' is not Mariana nor Anabela; every said token must be a whole token, in any order", async () => {
    expect(await search("Ana")).toEqual(["c-ana"]);
    expect(await search("Paula Ana")).toEqual(["c-ana"]);
    expect(await search("Ana Paulina")).toEqual([]);
    expect(await search("Mari")).toEqual([]);
    expect(await search("Anabela")).toEqual(["c-anabela"]);
  });
  it("hyphens and accents: 'hee jin', 'anne sophie' and 'icaro' find the registrations; a prefix of a token does not", async () => {
    for (const query of ["hee jin", "HEE-JIN", "Hee", "park hee"]) expect(await search(query)).toEqual(["c-heejin"]);
    for (const query of ["anne sophie", "Anne Sophie Moreau", "anne", "sophie moreau"]) expect(await search(query)).toEqual(["c-anne"]);
    for (const query of ["icaro", "ÍCARO MENDES", "Icaro"]) expect(await search(query)).toEqual(["c-icaro"]);
    for (const query of ["heej", "soph", "ica", "Mend"]) expect(await search(query)).toEqual([]);
    expect(await search("Iolanda Cunha")).toEqual(["c-iolanda"]);
  });
  it("homonyms all come back (the caller asks); order, projection and the bound of 21 are the historical ones", async () => {
    db.customers.push(customer("c-nara2", "Nara Quispe"));
    expect(await search("Nara")).toEqual(["c-nara2", "c-nara"]);
    expect(db.customerQueries.at(-1)).toEqual({ where: { salonId: "ours", mergedIntoId: null, OR: [{ id: { in: ["c-nara2", "c-nara"] } }] },
      select: { id: true, name: true, phone: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 21 });
    for (let i = 1; i <= 25; i++) db.customers.push(customer(`n${String(i).padStart(2, "0")}`, `Nara ${String(i).padStart(2, "0")}`));
    const bounded = await search("Nara");
    expect(bounded).toHaveLength(21); expect(bounded[0]).toBe("n01"); expect(bounded[20]).toBe("n21");
  });
  it("phone digits and exact e-mail keep their own paths", async () => {
    expect(await search("11988887702")).toEqual(["c-tainara"]);
    expect(await search("Nara 7701")).toEqual(["c-nara"]); // the digits find the phone; "7701" is no name token of anyone
    db.sql.length = 0;
    expect(await search("tainara.b@example.test")).toEqual(["c-tainara"]);
    expect(tokenStatements()).toEqual([]);
    await expect(search("tainara@")).rejects.toThrow("INVALID_EMAIL_REFERENCE");
  });
  it("particles or wildcards alone match nobody and read no row; a typed wildcard never widens a token", async () => {
    for (const query of ["de da", "%_", "__", "% %"]) expect(await search(query)).toEqual([]);
    expect(tokenStatements()).toEqual([]); expect(db.customerQueries).toEqual([]);
    expect(await search("Na%ra")).toEqual([]);
    expect(tokenStatements().at(-1)!.values[1]).toEqual(["%Na%", "%ra%"]);
  });
  it("an honorific is still searched as written and dropped only when nothing matches", async () => {
    expect(await search("dona nara")).toEqual(["c-nara"]);
    expect(tokenStatements().map(entry => entry.values[1])).toEqual([["%dona%", "%nara%"], ["%nara%"]]);
  });
  it("past the scan the historical search answers: a truncated whole-token set never proves a single match", async () => {
    for (let i = 0; i <= NAME_TOKEN_SCAN; i++) db.customers.push(customer(`bulk${i}`, `Nara ${i}`));
    const rows = await search("Nara");
    expect(rows).toHaveLength(21);
    expect(tokenStatements()).toHaveLength(1);
    expect(statements()).toContain(HISTORICAL_CUSTOMER_SQL);
    expect(db.customerQueries.at(-1)).toMatchObject({ where: { OR: [{ name: { contains: "Nara", mode: "insensitive" } }, { id: { in: expect.any(Array) } }] }, take: 21 });
  });
});

describe("customer search with the flag off (historical, byte-identical)", () => {
  it("issues the historical statement and arguments; 'Nara' still finds Tainara; 'anne sophie' still misses the hyphen", async () => {
    expect(await search("Nara")).toEqual(["c-nara", "c-tainara"]);
    expect(statements()).toContain(HISTORICAL_CUSTOMER_SQL);
    expect(db.sql.find(entry => entry.sql === HISTORICAL_CUSTOMER_SQL)!.values).toEqual(["ours", FOLD_FROM, FOLD_TO, "%Nara%", FOLD_FROM, FOLD_TO]);
    expect(db.customerQueries).toEqual([{ where: { salonId: "ours", mergedIntoId: null, OR: [{ name: { contains: "Nara", mode: "insensitive" } }, { id: { in: ["c-nara", "c-tainara"] } }] },
      select: { id: true, name: true, phone: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 21 }]);
    expect(await search("anne sophie")).toEqual([]);
    expect(tokenStatements()).toEqual([]);
  });
  it("any value other than 'true' keeps the historical search", async () => {
    for (const value of ["TRUE", "1", ""]) { vi.stubEnv(FLAG, value); expect(await search("Ana")).toEqual(["c-ana", "c-anabela", "c-mariana"]); }
    expect(tokenStatements()).toEqual([]);
  });
});

describe("professional search", () => {
  it("flag on: 'Ana' is Ana Beatriz only (not Mariana, not Luana); inactive and other-salon homonyms never appear", async () => {
    vi.stubEnv(FLAG, "true");
    expect(await pros("Ana")).toEqual(["p-ana"]);
    expect(await pros("o Ana")).toEqual(["p-ana"]);
    expect(db.proQueries.at(-1)).toEqual({ where: { salonId: "ours", active: true, id: { in: ["p-ana"] } }, select: { id: true, user: { select: { name: true } } }, orderBy: { id: "asc" }, take: 21 });
    expect(tokenStatements().at(-1)!.sql).toContain('FROM "Professional" p JOIN "User" u ON u.id=p."userId" WHERE p."salonId"=? AND p.active AND NOT EXISTS');
    expect(statements()).not.toContain(HISTORICAL_PROFESSIONAL_SQL);
    for (const query of ["hee jin", "Hee-Jin", "choi"]) expect(await pros(query)).toEqual(["p-heejin"]);
    expect(await pros("Mari")).toEqual([]);
  });
  it("flag on: homonyms are all returned (a card), no name is the whole team, particles alone are nobody", async () => {
    vi.stubEnv(FLAG, "true");
    db.pros.push({ id: "p-ana2", salonId: "ours", name: "Ana Kim", active: true });
    expect(await pros("Ana")).toEqual(["p-ana", "p-ana2"]);
    db.sql.length = 0;
    expect(await pros()).toEqual(["p-ana", "p-ana2", "p-heejin", "p-luana", "p-mariana"]);
    expect(tokenStatements()).toEqual([]);
    db.proQueries.length = 0;
    expect(await pros("de do")).toEqual([]);
    expect(db.proQueries).toEqual([]);
  });
  it("flag off: the historical statement and arguments; 'Ana' still finds Luana and Mariana", async () => {
    expect(await pros("Ana")).toEqual(["p-ana", "p-luana", "p-mariana"]);
    expect(db.sql.find(entry => entry.sql === HISTORICAL_PROFESSIONAL_SQL)!.values).toEqual(["ours", FOLD_FROM, FOLD_TO, "%Ana%", FOLD_FROM, FOLD_TO]);
    expect(db.proQueries).toEqual([{ where: { salonId: "ours", active: true, OR: [{ user: { name: { contains: "Ana", mode: "insensitive" } } }, { id: { in: ["p-ana", "p-luana", "p-mariana"] } }] },
      select: { id: true, user: { select: { name: true } } }, orderBy: { id: "asc" }, take: 21 }]);
    expect(tokenStatements()).toEqual([]);
  });
});

describe("the Secretária's customer card (real adapter, no model)", () => {
  it("homonyms are still a card: both registered Naras are options, Tainara is not", async () => {
    vi.stubEnv(FLAG, "true"); db.customers.push(customer("c-nara2", "Nara Quispe"));
    const c = customerState(); await applyCustomerInterpretation(actor, c, { operation: "customer.read", target_name: "Nara" });
    expect(c.candidates?.map(row => row.id)).toEqual(["c-nara2", "c-nara"]);
    expect(c.target).toBeUndefined();
    expect(c.message).toBe("Encontrei mais de um cliente. Selecione qual deseja.");
  });
  it("one whole-token match resolves without a card (before the flag, Nara and Tainara were a card)", async () => {
    const before = customerState(); await applyCustomerInterpretation(actor, before, { operation: "customer.read", target_name: "Nara" });
    expect(before.candidates?.map(row => row.id)).toEqual(["c-nara", "c-tainara"]);
    vi.stubEnv(FLAG, "true");
    const c = customerState(); await applyCustomerInterpretation(actor, c, { operation: "customer.read", target_name: "Nara" });
    expect(c.target).toBe("c-nara"); expect(c.candidates).toBeUndefined(); expect(c.message).toContain("Nome: Nara Uchoa");
  });
  it("a card shown before the flag cannot select a substring-only row afterwards (the click re-runs the search)", async () => {
    const c = customerState(); await applyCustomerInterpretation(actor, c, { operation: "customer.read", target_name: "Nara" });
    expect(c.candidates?.map(row => row.id)).toEqual(["c-nara", "c-tainara"]);
    vi.stubEnv(FLAG, "true");
    await expect(selectCustomer(actor, c, "c-tainara")).rejects.toThrow("SELECTION_INVALID");
    expect(c.target).toBeUndefined();
    await selectCustomer(actor, c, "c-nara");
    expect(c.target).toBe("c-nara"); expect(c.message).toContain("Nome: Nara Uchoa");
  });
});
