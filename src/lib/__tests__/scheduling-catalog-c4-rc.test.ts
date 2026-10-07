import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { PROFESSIONAL_DAY_HORIZON, listSchedulingServices, professionalReadDay, serviceNameKey, serviceWordsMatch } from "../scheduling-catalog";

/** C4 round R-C, the tenant queries behind two owner decisions (offline fake transaction; Tuesday 29/09/2026 12h in São Paulo):
 * - rule 6: the day a read of ONE professional with no day said is about (scheduling-catalog professionalReadDay; flag
 *   SALON_SECRETARY_READS_V2 decides only whether the adapter asks it). Today while any PENDING/CONFIRMED appointment of that
 *   professional is left, else their next working day from the tenant's hours, openings, closures and time off; undefined when
 *   the hours cannot tell (the day is asked). Read-only, tenant scoped.
 * - a service said with or without the connective "de" ("manutenção da fibra", "coloração de raiz") is the registered one
 *   (flag SALON_SECRETARY_MULTI_SERVICE): only after the historical search finds nothing, never a combo, several still ask.
 * Synthetic nail studio / spa names; no gender inferred from any name. */
type Span = { startAt: Date; endAt: Date };
const db = { access: "APPROVED", role: "OWNER", pro: true, left: null as null | { id: string }, anyHours: true,
  weekly: [] as { weekday: number; startMinutes: number; endMinutes: number }[], openings: [] as { dateKey: string; startMinutes: number; endMinutes: number }[],
  closures: [] as Span[], offs: [] as Span[], services: [] as { id: string; name: string; category?: string | null }[] };
let calls: Record<string, Record<string, unknown>[]> = {};
const spy = <T,>(name: string, value: (args: Record<string, unknown>) => T) => vi.fn(async (args: Record<string, unknown>) => { (calls[name] ??= []).push(args); return value(args); });
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const service = (id: string, name: string) => ({ id, name, durationMin: 60, priceCents: 9000, priceType: "FIXED" });
const tx = () => ({
  // The access check (salon approved, a staff role) and the folded LIKE of the service search (ids whose folded name holds the term).
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("accessStatus")) return [{ accessStatus: db.access }];
    if (sql.includes("Membership")) return [{ role: db.role }];
    const term = fold(String(values[3]).slice(1, -1));
    return db.services.filter(row => fold(row.name).includes(term)).map(row => ({ id: row.id }));
  }),
  salon: { findUniqueOrThrow: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })) },
  professional: { findFirst: spy("professional", () => db.pro ? { id: "pro-iara" } : null) },
  appointment: { findFirst: spy("appointment", () => db.left) },
  workingHours: { findFirst: spy("anyHours", () => db.anyHours ? { id: "wh-1" } : null), findMany: spy("weekly", () => db.weekly) },
  professionalOpening: { findMany: spy("openings", () => db.openings) },
  salonClosure: { findMany: spy("closures", () => db.closures) },
  timeOff: { findMany: spy("offs", () => db.offs) },
  service: { findMany: spy("services", args => {
    const where = args.where as { name?: { contains: string }; OR?: ({ name?: { contains: string }; id?: { in: string[] } })[] };
    const said = where.name ?? where.OR?.[0]?.name, ids = where.OR?.[1]?.id?.in ?? [];
    return db.services.filter(row => !said || row.name.toLowerCase().includes(said.contains.toLowerCase()) || ids.includes(row.id))
      .map(row => ({ ...service(row.id, row.name), ...((args.select as Record<string, unknown>).category ? { category: row.category ?? null } : {}) }));
  }) },
}) as unknown as Tx;
const actor = { salonId: "salon-lume", userId: "user-lume" };
const local = (at: string) => new Date(`${at}:00-03:00`);
const wednesdays = [{ weekday: 3, startMinutes: 540, endMinutes: 1080 }];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  Object.assign(db, { access: "APPROVED", role: "OWNER", pro: true, left: null, anyHours: true, weekly: [], openings: [], closures: [], offs: [], services: [] });
  calls = {};
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("rule 6: the day of a professional read with no day said", () => {
  it("an appointment of that professional still left today: today (the service filter in the same query), nothing else read", async () => {
    db.left = { id: "apt-1" }; db.weekly = wednesdays;
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara", service_ref: "svc-gel" })).toEqual({ date: "2026-09-29", today: true });
    expect(calls.appointment[0].where).toEqual({ salonId: "salon-lume", professionalId: "pro-iara", status: { in: ["PENDING", "CONFIRMED"] },
      startAt: { gte: new Date("2026-09-29T15:00:00Z"), lt: new Date("2026-09-30T03:00:00Z") }, OR: [{ serviceId: "svc-gel" }, { serviceItems: { some: { serviceId: "svc-gel" } } }] });
    expect(calls.weekly).toBeUndefined();
  });
  it("nothing left today: the next weekday they work (a Wednesday-only professional); on a Wednesday itself, the following one", async () => {
    db.weekly = wednesdays;
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toEqual({ date: "2026-09-30", today: false });
    expect(calls.appointment[0].where).not.toHaveProperty("OR");
    vi.setSystemTime(new Date("2026-09-30T15:00:00Z"));
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toEqual({ date: "2026-10-07", today: false });
  });
  it("a salon closure or the professional's own time off taking the whole working day skips it; a partial one does not", async () => {
    db.weekly = wednesdays; db.closures = [{ startAt: local("2026-09-30T00:00"), endAt: local("2026-10-01T00:00") }];
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toEqual({ date: "2026-10-07", today: false });
    db.closures = []; db.offs = [{ startAt: local("2026-09-30T09:00"), endAt: local("2026-09-30T18:00") }];
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toEqual({ date: "2026-10-07", today: false });
    db.offs = [{ startAt: local("2026-09-30T12:00"), endAt: local("2026-09-30T13:00") }];
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toEqual({ date: "2026-09-30", today: false });
  });
  it("an extra opening on a day without weekly hours is a working day", async () => {
    db.weekly = wednesdays; db.openings = [{ dateKey: "2026-09-30", startMinutes: 0, endMinutes: 0 }, { dateKey: "2026-10-01", startMinutes: 540, endMinutes: 720 }];
    // An empty opening is no hour at all; Thursday's opening is not before Wednesday's weekly hours, so Wednesday stays first.
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toEqual({ date: "2026-09-30", today: false });
    db.weekly = [{ weekday: 5, startMinutes: 540, endMinutes: 1080 }];
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toEqual({ date: "2026-10-01", today: false });
  });
  it("adversarial: no hours configured in the salon, or no working day within the horizon: undefined (the day is asked, never guessed)", async () => {
    db.anyHours = false; db.weekly = wednesdays;
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toBeUndefined();
    expect(calls.weekly).toBeUndefined();
    db.anyHours = true; db.weekly = [];
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toBeUndefined();
    db.weekly = wednesdays; db.offs = [{ startAt: local("2026-09-29T00:00"), endAt: local("2026-12-31T00:00") }];
    expect(await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).toBeUndefined();
    expect(PROFESSIONAL_DAY_HORIZON).toBe(31);
  });
  it("tenant scope: every query is the actor's salon, and the horizon bounds what is read", async () => {
    db.weekly = wednesdays;
    await professionalReadDay(tx(), actor, { professional_ref: "pro-iara" });
    expect(calls.professional[0].where).toEqual({ id: "pro-iara", salonId: "salon-lume" });
    expect(calls.anyHours[0].where).toEqual({ salonId: "salon-lume" });
    expect(calls.weekly[0].where).toEqual({ salonId: "salon-lume", professionalId: "pro-iara" });
    expect(calls.openings[0].where).toEqual({ salonId: "salon-lume", professionalId: "pro-iara", dateKey: { gte: "2026-09-30", lte: "2026-10-30" } });
    expect(calls.closures[0].where).toEqual({ salonId: "salon-lume", startAt: { lt: new Date("2026-10-31T03:00:00Z") }, endAt: { gt: new Date("2026-09-30T03:00:00Z") } });
    expect(calls.offs[0].where).toEqual({ professionalId: "pro-iara", professional: { salonId: "salon-lume" }, startAt: { lt: new Date("2026-10-31T03:00:00Z") }, endAt: { gt: new Date("2026-09-30T03:00:00Z") } });
  });
  it("adversarial: a professional of another salon is refused before any appointment is read; a PROFESSIONAL membership is refused", async () => {
    db.pro = false;
    await expect(professionalReadDay(tx(), actor, { professional_ref: "pro-elsewhere" })).rejects.toThrow("PROFESSIONAL_NOT_FOUND");
    expect(calls.appointment).toBeUndefined();
    db.pro = true; db.role = "PROFESSIONAL";
    await expect(professionalReadDay(tx(), actor, { professional_ref: "pro-iara" })).rejects.toThrow("FORBIDDEN");
    expect(calls.professional).toHaveLength(1);
    db.role = "OWNER";
    await expect(professionalReadDay(tx(), actor, { professional_ref: "" })).rejects.toThrow();
    expect(calls.appointment).toBeUndefined();
  });
});

describe("a service said with or without 'de' (flag SALON_SECRETARY_MULTI_SERVICE)", () => {
  const catalog = () => { db.services = [{ id: "svc-fibra", name: "Manutenção de fibra" }, { id: "svc-along", name: "Alongamento em fibra" }, { id: "svc-raiz", name: "Coloração raiz" },
    { id: "svc-combo", name: "Pé e mão" }, { id: "svc-henna", name: "Design com henna" }, { id: "svc-spa", name: "Spa dos pés" }]; };
  beforeEach(() => { vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "true"); catalog(); });
  it("the key: word by word in order, without 'de' and its contractions; 'e' and every other word kept", () => {
    expect(serviceNameKey("manutencao da fibra")).toBe(serviceNameKey("Manutenção de fibra"));
    expect(serviceNameKey("coloração de raiz")).toBe(serviceNameKey("Coloração raiz"));
    expect(serviceNameKey("o spa do pés")).toBe(serviceNameKey("Spa dos pés"));
    expect(serviceNameKey("pé mão")).not.toBe(serviceNameKey("Pé e mão"));
    expect(serviceNameKey("design e henna")).not.toBe(serviceNameKey("Design com henna"));
    expect(serviceNameKey("fibra de manutenção")).not.toBe(serviceNameKey("Manutenção de fibra"));
    expect(serviceNameKey("da do de")).toBe("");
  });
  it("nothing holds the words as said: the one registered service of the same key", async () => {
    expect((await listSchedulingServices(tx(), actor, "manutencao da fibra")).map(row => row.id)).toEqual(["svc-fibra"]);
    expect((await listSchedulingServices(tx(), actor, "coloracao de raiz")).map(row => row.id)).toEqual(["svc-raiz"]);
    expect(calls.services.at(-1)!.where).toEqual({ salonId: "salon-lume", active: true });
    expect(calls.services.at(-1)!.take).toBe(1000);
  });
  it("adversarial: never a combo or another word ('pé mão', 'design e henna', 'manutencao fibra longa'), and two of the same key are both returned (asked)", async () => {
    expect(await listSchedulingServices(tx(), actor, "pe mao")).toEqual([]);
    expect(await listSchedulingServices(tx(), actor, "design e henna")).toEqual([]);
    expect(await listSchedulingServices(tx(), actor, "manutencao da fibra longa")).toEqual([]);
    db.services.push({ id: "svc-fibra-2", name: "Manutenção da fibra" });
    expect((await listSchedulingServices(tx(), actor, "manutencao fibra")).map(row => row.id).sort()).toEqual(["svc-fibra", "svc-fibra-2"]);
  });
  it("a search that finds something is the historical one (no second query)", async () => {
    expect((await listSchedulingServices(tx(), actor, "fibra")).map(row => row.id).sort()).toEqual(["svc-along", "svc-fibra"]);
    expect(calls.services).toHaveLength(1);
  });
  it("flag off: the historical empty result (nothing else read)", async () => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "false");
    expect(await listSchedulingServices(tx(), actor, "manutencao da fibra")).toEqual([]);
    expect(calls.services).toHaveLength(1);
  });
});

/** Owner 07/10 (flag SALON_SECRETARY_SERVICE_ABBREVIATIONS): the owner registers abbreviated ("Combo Masc: …") and says the
 * whole word ("combo masculino"). Catalog shaped like a real studio's combos (scripts/seed-martinelli.ts). */
describe("a service the catalog abbreviates (flag SALON_SECRETARY_SERVICE_ABBREVIATIONS)", () => {
  const combos = [["svc-cb-hidr", "Combo Masc: Corte + barba + hidratação"], ["svc-cb-pent", "Combo Masc: Corte + barba + penteado"],
    ["svc-cb-prog", "Combo Masc: Corte + progressiva + penteado"], ["svc-cb-botox", "Combo Masc. Corte + botox + barba"]] as const;
  beforeEach(() => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_ABBREVIATIONS", "true");
    db.services = [...combos.map(([id, name]) => ({ id, name, category: "Combo Masculino" })),
      { id: "svc-cm-sobr", name: "Corte Masculino + Sobrancelha na Navalha", category: "Combo Masculino" },
      { id: "svc-cf", name: "Combo Fem: Escova + hidratação", category: "Combo Feminino" },
      { id: "svc-esc", name: "Escova Progr. curta", category: "Escova" }, { id: "svc-unha", name: "Unha gel", category: "Unhas" },
      { id: "svc-pe", name: "Pé e mão", category: null }, { id: "svc-henna", name: "Design com henna", category: "Sobrancelha" },
      { id: "svc-pedi", name: "Pedicure", category: null }];
  });
  const ids = async (said: string) => (await listSchedulingServices(tx(), actor, said)).map(row => row.id).sort();
  it("the words of the name, a registered abbreviation counting as the whole word; the category of the same words joins them (a card)", async () => {
    expect(await ids("combo masculino")).toEqual([...combos.map(([id]) => id), "svc-cm-sobr"].sort());
    expect(await ids("combo masculino corte barba hidratação")).toEqual(["svc-cb-hidr"]);
    expect(await ids("combo masculino corte progressiva")).toEqual(["svc-cb-prog"]);
    expect(await ids("combo masculino corte botox")).toEqual(["svc-cb-botox"]);
    expect(await ids("escova progressiva curta")).toEqual(["svc-esc"]);
    expect(await ids("unhas gel")).toEqual(["svc-unha"]);
  });
  it("the rows keep the search projection and its bound (no category returned, at most 21)", async () => {
    const [row] = await listSchedulingServices(tx(), actor, "combo masculino corte barba hidratacao");
    expect(row).toEqual({ id: "svc-cb-hidr", name: "Combo Masc: Corte + barba + hidratação", durationMin: 60, priceCents: 9000, priceType: "FIXED" });
    expect(calls.services.at(-1)!.where).toEqual({ salonId: "salon-lume", active: true });
    db.services = Array.from({ length: 30 }, (_, i) => ({ id: `svc-${String(i).padStart(2, "0")}`, name: `Combo Masc: opção ${i}`, category: null }));
    expect(await listSchedulingServices(tx(), actor, "combo masculino")).toHaveLength(21);
  });
  it("adversarial: never another word, another order, a 2-letter abbreviation or a word the name lacks", async () => {
    expect(await ids("design e henna")).toEqual([]);
    expect(await ids("pe mao")).toEqual([]);
    expect(await ids("masculino combo")).toEqual([]);
    expect(await ids("combo masculino escova")).toEqual([]);
    expect(await ids("combo feminino escova")).toEqual(["svc-cf"]);
    expect(serviceWordsMatch("pe", "Pedicure")).toBe(false);
    expect(serviceWordsMatch("combo masculino", "Combo Masculino Premium", true)).toBe(false);
  });
  it("a search that finds something is the historical one (no second query)", async () => {
    expect(await ids("combo masc")).toEqual(combos.map(([id]) => id).sort());
    expect(calls.services).toHaveLength(1);
  });
  it("flag off: the historical empty result (nothing else read)", async () => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_ABBREVIATIONS", "false");
    expect(await ids("combo masculino")).toEqual([]);
    expect(calls.services).toHaveLength(1);
  });
});

/** Owner 07/10 (flag SALON_SECRETARY_SERVICE_PICK_GUARD): one service found alone is taken only when it is the name said, or when
 * the words said name what it is (its first word) and no other service holds them all; otherwise a card or the suggestions. */
describe("one service found is taken alone only when nothing else reads the same (flag SALON_SECRETARY_SERVICE_PICK_GUARD)", () => {
  beforeEach(() => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_PICK_GUARD", "true");
    db.services = [{ id: "svc-combo", name: "Corte Masculino + Sobrancelha na Navalha" }, { id: "svc-corte", name: "Corte de cabelo masculino" },
      { id: "svc-spa", name: "Spa das mãos" }, { id: "svc-mani", name: "Manicure" }, { id: "svc-luzes", name: "Luzes em cabelo masculino" },
      { id: "svc-mao", name: "Mão simples" }];
  });
  const ids = async (said: string) => (await listSchedulingServices(tx(), actor, said)).map(row => row.id);
  it("another service holding every word said joins the one found: a card, never the combo alone", async () => {
    expect((await ids("corte masculino")).sort()).toEqual(["svc-combo", "svc-corte"]);
    expect(calls.services.at(-1)!.where).toEqual({ salonId: "salon-lume", active: true });
  });
  it("a name said only by a detail of the service ('mão' in 'Spa das mãos') finds nothing here (the suggestions ask)", async () => {
    db.services = db.services.filter(row => row.id !== "svc-mao");
    expect(await ids("mão")).toEqual([]);
  });
  it("the whole name, or its first word with nothing else alike, is still taken alone (no extra click)", async () => {
    expect(await ids("Manicure")).toEqual(["svc-mani"]);
    expect(await ids("luzes")).toEqual(["svc-luzes"]);
    expect(await ids("mão simples")).toEqual(["svc-mao"]);
  });
  it("several found: the historical rows, nothing else read", async () => {
    expect((await ids("cabelo masculino")).sort()).toEqual(["svc-corte", "svc-luzes"]);
    expect(calls.services).toHaveLength(1);
  });
  it("flag off: the one found is returned alone, as before", async () => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_PICK_GUARD", "false");
    expect(await ids("corte masculino")).toEqual(["svc-combo"]);
    expect(calls.services).toHaveLength(1);
  });
});
