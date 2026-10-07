import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Owner 07/10 (flag SALON_SECRETARY_RECURRING_SERIES, with SALON_SECRETARY_RECURRENCE_GUARD): a weekly or fortnightly create the owner's
 * words state is offered as a series (the manual agenda's: one appointment per date, a taken date skipped and said before Confirmar).
 * The closed grammar (pure) and the real scheduling adapter (grounding, journal drafts, cards, proposals); only tenant lookups and the
 * proposal snapshot are fixtures. Today is Wednesday 07/10/2026, 12h in São Paulo: "sexta" = 09/10. The recorded case: "marque um
 * horário para o Edgar Lopes todas as sextas-feiras de outubro, oito e meia da manhã" (video of 07/10). Names are synthetic. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], proposed: 0, taken: [] as string[], snapshots: [] as Record<string, unknown>[] }));
const SERVICES: Record<string, string> = { "s-corte": "Corte masculino", "s-barba": "Barba" };
const CUSTOMERS: Record<string, { id: string; name: string }> = { edgar: { id: "c-edgar", name: "Edgard Lopes" }, hiroshi: { id: "c-hiroshi", name: "Hiroshi Tanaka" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => {
    const all = [{ id: "pro-nara", name: "Nara Quintela" }];
    return filter.query ? all.filter(row => fold(row.name).startsWith(fold(filter.query!).split(" ")[0])) : all;
  },
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-actions")>();
  const { seriesDates } = await import("../secretary-series");
  const end = (date: string, time: string) => `${date}T${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`;
  return { ...original,
    // The real snapshot's shape; a series lists every later date free except db.taken (the domain's SLOT_TAKEN).
    schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, unknown> & { date: string; time: string; series?: { step_days: 7 | 14; until: string } }) => {
      db.snapshots.push(structuredClone(f));
      const first = { customer_ref: f.customer_ref, customer_name: "Edgard Lopes", service_ref: f.service_ref, service_revision: "1", service_name: SERVICES[f.service_ref as string] ?? f.service_name,
        professional_ref: f.professional_ref, professional_name: "Nara Quintela", date: f.date, startLocal: `${f.date}T${f.time}`, endLocal: end(f.date, f.time), timezone: "America/Sao_Paulo",
        priceCents: 8000, priceType: "FIXED", durationMin: 60, quote: "q" };
      if (!f.series) return first;
      const later = seriesDates(f.date, f.series.step_days, f.series.until)!.slice(1);
      return { ...first, series: { ...f.series, occurrences: later.filter(date => !db.taken.includes(date)).map(date => ({ startLocal: `${date}T${f.time}`, endLocal: end(date, f.time), quote: "q" })),
        skipped: later.filter(date => db.taken.includes(date)).map(date => ({ date, cause: "SLOT_TAKEN" })) } };
    },
    proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) => {
      db.proposed++;
      return { proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() };
    } };
});
vi.mock("../scheduling-mutations", async importOriginal => ({ ...await importOriginal<object>(), authorizeSchedulingOperation: async () => "OWNER" }));
import { FIRST_ONLY_REF, statedRecurrence } from "../secretary-recurrence";
import { SERIES_REF, SERIES_UNTIL_PREFIX, seriesDates, seriesEnd, seriesFirstDay, seriesQuestion, seriesRule, seriesSkippedText, seriesStartSaid, seriesUntil } from "../secretary-series";
import { applySchedulingInterpretation, schedulingState, selectScheduling } from "../secretary-scheduling";
import { appointmentCreatePreview } from "../scheduling-actions";

const actor = { salonId: "synthetic-barbershop", userId: "synthetic-owner" };
const TODAY = "2026-10-07";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "true"); vi.stubEnv("SALON_SECRETARY_RECURRING_SERIES", "true");
  Object.assign(db, { rows: [], proposed: 0, taken: [], snapshots: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the series grammar (pure; the owner's words only)", () => {
  it.each([
    ["toda sexta", { step_days: 7, weekday: 5 }], ["todas as sextas-feiras", { step_days: 7, weekday: 5 }], ["às terças", { step_days: 7, weekday: 2 }],
    ["sempre na quinta", { step_days: 7, weekday: 4 }], ["toda semana", { step_days: 7, weekday: null }], ["semanal", { step_days: 7, weekday: null }],
    ["uma vez por semana", { step_days: 7, weekday: null }], ["quinzenalmente", { step_days: 14, weekday: null }], ["de 15 em 15 dias", { step_days: 14, weekday: null }],
    ["a cada duas semanas", { step_days: 14, weekday: null }], ["a cada 15 dias", { step_days: 14, weekday: null }], ["semana sim, semana não", { step_days: 14, weekday: null }],
    ["sexta sim, sexta não", { step_days: 14, weekday: 5 }],
  ])("%j is a series %j", (expression, rule) => { expect(seriesRule(expression)).toEqual(rule); });
  it.each(["todo dia", "diariamente", "todo mês", "mensal", "toda manhã", "terças e quintas", "2x por semana", "a cada 3 semanas", "todos os fins de semana"])(
    "%j is not a series the agenda creates (the guard's 'só a primeira?' stays)", expression => { expect(seriesRule(expression)).toBeUndefined(); });
  it("reads the end the owner says, and never a day of the first date as the end", () => {
    const text = "marque o Edgar todas as sextas-feiras de outubro, oito e meia";
    expect(seriesEnd(text, TODAY, statedRecurrence(text)!.end)).toEqual({ month: 10 });
    expect(seriesEnd("toda sexta deste mês", TODAY, statedRecurrence("toda sexta deste mês")!.end)).toEqual({ month: "FIRST" });
    for (const [said, end] of [["até o fim do mês", { month: "FIRST" }], ["até dia 30", { until: "2026-10-30" }], ["até 13/11", { until: "2026-11-13" }], ["até 20 de novembro", { until: "2026-11-20" }],
      ["até novembro", { month: 11 }], ["por 6 semanas", { weeks: 6 }], ["nas próximas três semanas", { weeks: 3 }], ["4 vezes", { count: 4 }], ["oito sessões", { count: 8 }], ["até dia 3", { until: "2026-11-03" }]] as const)
      expect(seriesEnd(said, TODAY), said).toEqual(end);
    // "a partir de 16 de outubro" starts the series; it is no end. A date without "até" is not one either.
    expect(seriesEnd("toda sexta a partir de 16 de outubro", TODAY, statedRecurrence("toda sexta a partir de 16 de outubro")!.end)).toBeUndefined();
    expect(seriesEnd("toda sexta, começa dia 16", TODAY)).toBeUndefined();
  });
  it("review 07/10: no false ends or starts, a recent past end stays past, and an unknown cause is never 'ocupado'", () => {
    expect(seriesEnd("toda sexta, ela faz 2 atendimentos", TODAY)).toBeUndefined();
    expect(seriesEnd("toda sexta, umas 2 vezes por mês", TODAY)).toBeUndefined();
    expect(seriesEnd("toda sexta, 3 vezes", TODAY)).toEqual({ count: 3 });
    expect(seriesEnd("toda sexta até 30/09", TODAY)).toEqual({ until: "2026-09-30" });
    expect(seriesEnd("toda sexta até 15/01", "2026-12-07")).toEqual({ until: "2027-01-15" });
    expect(seriesStartSaid("marca o João toda sexta às 9h nas próximas 6 semanas")).toBe(false);
    expect(seriesStartSaid("marca o João toda sexta a partir da próxima semana")).toBe(true);
    expect(seriesSkippedText([{ date: "2026-10-23", cause: "UNAVAILABLE" }, { date: "2026-10-30", cause: "SLOT_TAKEN" }])).toBe("23/10 (indisponível), 30/10 (horário ocupado)");
    expect(appointmentCreatePreview({ customer_name: "Edgard Lopes", service_name: "Corte + Barba", professional_name: "Nara Quintela", startLocal: "2026-10-09T08:30", endLocal: "2026-10-09T09:30",
      priceType: "FIXED", priceCents: 12000, services: [{ service_ref: "s-corte", service_revision: "1", service_name: "Corte", priceCents: 8000, priceType: "FIXED", durationMin: 30 },
        { service_ref: "s-barba", service_revision: "1", service_name: "Barba", priceCents: 4000, priceType: "FIXED", durationMin: 30 }],
      series: { step_days: 7, until: "2026-10-31", occurrences: [{ startLocal: "2026-10-16T08:30", endLocal: "2026-10-16T09:30", quote: "q" }], skipped: [] } })).toMatch(/^NOVOS AGENDAMENTOS \(SÉRIE\)\n[\s\S]*\nPreço por data: R\$\s120,00\nRepete:/);
  });
  it("dates: from the first, every step, up to the end, at most 24", () => {
    expect(seriesUntil({ month: 10 }, "2026-10-09", 7)).toBe("2026-10-31");
    expect(seriesDates("2026-10-09", 7, "2026-10-31")).toEqual(["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
    expect(seriesDates("2026-10-09", 14, seriesUntil({ count: 3 }, "2026-10-09", 14)!)).toEqual(["2026-10-09", "2026-10-23", "2026-11-06"]);
    expect(seriesUntil({ weeks: 2 }, "2026-10-09", 7)).toBe("2026-10-22");
    expect(seriesUntil({ until: "2026-10-01" }, "2026-10-09", 7)).toBeUndefined();
    expect(seriesDates("2026-10-09", 7, "2027-06-30")).toBeUndefined();
    // The first Friday from today, or from the month named; today itself only while the clock is still ahead.
    expect(seriesFirstDay({ step_days: 7, weekday: 5 }, TODAY, "12:00", "08:30")).toBe("2026-10-09");
    expect(seriesFirstDay({ step_days: 7, weekday: 3 }, TODAY, "12:00", "08:30")).toBe("2026-10-14");
    expect(seriesFirstDay({ step_days: 7, weekday: 3 }, TODAY, "12:00", "18:00")).toBe(TODAY);
    expect(seriesFirstDay({ step_days: 7, weekday: 5 }, TODAY, "12:00", "08:30", { month: 11 })).toBe("2026-11-06");
    expect(seriesFirstDay({ step_days: 7, weekday: null }, TODAY, "12:00", "08:30")).toBeUndefined();
  });
  it("the card says the free dates and the skipped ones, with 'só a primeira' beside", () => {
    const asked = seriesQuestion({ step_days: 7, until: "2026-10-31", first: "2026-10-09", occurrences: [{ startLocal: "2026-10-16T08:30" }, { startLocal: "2026-10-30T08:30" }], skipped: [{ date: "2026-10-23", cause: "SLOT_TAKEN" }] }, "08:30");
    expect(asked.message).toBe("Repetindo toda semana às 8h30, de sex, 09/10 a sáb, 31/10. Datas livres: 09/10, 16/10, 30/10. Ficam de fora: 23/10 (horário ocupado). Marco as 3 datas?");
    expect(asked.card.items).toEqual([{ id: SERIES_REF, name: "Marcar as 3 datas: 09/10, 16/10, 30/10" }, { id: FIRST_ONLY_REF, name: "Só a primeira: sex, 09/10 às 8h30" }]);
  });
  it("the proposal preview lists every date and those left out", () => {
    expect(appointmentCreatePreview({ customer_name: "Edgard Lopes", service_name: "Corte masculino", professional_name: "Nara Quintela", startLocal: "2026-10-09T08:30", endLocal: "2026-10-09T09:30",
      priceType: "FIXED", priceCents: 8000, series: { step_days: 7, until: "2026-10-31", occurrences: [{ startLocal: "2026-10-16T08:30", endLocal: "2026-10-16T09:30", quote: "q" }], skipped: [{ date: "2026-10-23", cause: "SALON_CLOSED" }] } }))
      .toMatch(/^NOVOS AGENDAMENTOS \(SÉRIE\)\n[\s\S]*\nPreço por data: R\$\s80,00\nRepete: toda semana · 2 datas: 09\/10, 16\/10\nFicam de fora: 23\/10 \(salão fechado\)$/);
  });
});

const edgar = { operation: "appointment.create" as const, customer_name: "Edgar Lopes", service_name: "corte", professional_name: "Nara", time: "08:30",
  temporal_evidence: [{ field: "time" as const, text: "oito e meia da manhã" }] };
const VIDEO = "Eu quero que você marque um horário para o Edgar Lopes todas as sextas-feiras de outubro, oito e meia da manhã, corte com a Nara";
describe("the real scheduling adapter", () => {
  it("the recorded request: the first Friday from today, the October Fridays listed with the taken one left out; the series pick proposes", async () => {
    db.taken = ["2026-10-23"];
    const c = schedulingState();
    const codes = await applySchedulingInterpretation(actor, c, edgar, VIDEO);
    expect(codes).toEqual(expect.arrayContaining(["RECURRENCE_STATED", "RECURRENCE_FIRST_DAY", "RECURRENCE_SERIES_ASKED"]));
    expect(c.fields).toMatchObject({ date: "2026-10-09", time: "08:30", customer_ref: "c-edgar", professional_ref: "pro-nara" });
    expect(c.message).toBe("Repetindo toda semana às 8h30, de sex, 09/10 a sáb, 31/10. Datas livres: 09/10, 16/10, 30/10. Ficam de fora: 23/10 (horário ocupado). Marco as 3 datas?");
    expect(c.message).not.toContain("Ainda não");
    expect(c.candidates?.items.map(item => item.id)).toEqual([SERIES_REF, FIRST_ONLY_REF]);
    expect(c.proposal).toBeUndefined(); expect(db.proposed).toBe(0);
    await selectScheduling(actor, c, SERIES_REF);
    expect(c.recurrence?.status).toBe("SERIES");
    expect(c.fields.series).toEqual({ step_days: 7, until: "2026-10-31" });
    expect(c.proposal).toBeDefined(); expect(db.proposed).toBe(1);
    expect(db.snapshots.at(-1)).toMatchObject({ date: "2026-10-09", series: { step_days: 7, until: "2026-10-31" } });
  });
  it("demo 07/10: the model's refused single-date reading of the recurrence never drops the derived first Friday (card, pick, proposal)", async () => {
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
    const c = schedulingState();
    const said = { ...edgar, temporal_evidence: [{ field: "date" as const, text: "todas as sextas-feiras de outubro", component: { kind: "DAY_OF_MONTH", offset: null, weekday: 5, week: null, day: null, month: 10, year: null, days: null } },
      { field: "time" as const, text: "oito e meia da manhã", component: { hour: 8, minute: 30, daypart: "MANHA" } }] };
    await applySchedulingInterpretation(actor, c, said as Parameters<typeof applySchedulingInterpretation>[2], VIDEO);
    expect(c.message).toMatch(/^Repetindo toda semana às 8h30, de sex, 09\/10 a sáb, 31\/10\./);
    expect(c.fields.date).toBe("2026-10-09");
    await selectScheduling(actor, c, SERIES_REF);
    expect(c.fields).toMatchObject({ date: "2026-10-09", series: { step_days: 7, until: "2026-10-31" } }); expect(db.proposed).toBe(1);
  });
  it("a start day the owner says is never replaced by a derived one ('a partir do dia 16' read wrongly is asked)", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, edgar, "marca o Edgar toda sexta a partir do dia 16, oito e meia da manhã, corte com a Nara");
    expect(c.fields.date).toBeUndefined(); expect(c.message).not.toMatch(/^Repetindo/); expect(db.proposed).toBe(0);
  });
  it("no end said: 'até quando?' with shortcuts; the end picked shows the series card; 'só a primeira' still books one", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, { ...edgar, customer_name: "Hiroshi", time: "18:00", temporal_evidence: [{ field: "time", text: "às 18h" }] }, "marca o Hiroshi toda sexta às 18h, corte com a Nara");
    expect(c.message).toBe("Repetindo toda semana a partir de sex, 09/10 às 18h. Até quando marco?");
    expect(c.candidates?.items).toEqual([{ id: `${SERIES_UNTIL_PREFIX}2026-10-30`, name: "Até o fim do mês (sex, 30/10)" }, { id: `${SERIES_UNTIL_PREFIX}2026-11-27`, name: "8 datas (até sex, 27/11)" },
      { id: FIRST_ONLY_REF, name: "Só a primeira: sex, 09/10 às 18h" }]);
    await selectScheduling(actor, c, `${SERIES_UNTIL_PREFIX}2026-11-27`);
    expect(c.message).toMatch(/^Repetindo toda semana às 18h, de sex, 09\/10 a sex, 27\/11\. Datas livres: 09\/10, 16\/10, 23\/10, 30\/10, 06\/11, 13\/11, 20\/11, 27\/11\. Marco as 8 datas\?$/);
    expect(db.proposed).toBe(0);
    await selectScheduling(actor, c, FIRST_ONLY_REF);
    expect(c.recurrence?.status).toBe("FIRST_ONLY"); expect(c.fields.series).toBeUndefined(); expect(db.proposed).toBe(1);
  });
  it("an end typed in a later turn answers 'até quando?'", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, { ...edgar, customer_name: "Hiroshi" }, "marca o Hiroshi toda sexta às oito e meia da manhã, corte com a Nara");
    expect(c.message).toMatch(/Até quando marco\?$/);
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create" }, "por 3 semanas");
    expect(c.message).toBe("Repetindo toda semana às 8h30, de sex, 09/10 a qui, 29/10. Datas livres: 09/10, 16/10, 23/10. Marco as 3 datas?");
  });
  it("fortnightly, from the day the owner said", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, { ...edgar, day_offset: undefined, date: "2026-10-16", temporal_evidence: [{ field: "date", text: "dia 16" }, { field: "time", text: "oito e meia da manhã" }] },
      "marca o Edgar de 15 em 15 dias, começando dia 16, oito e meia da manhã, 4 vezes, corte com a Nara");
    expect(c.message).toBe("Repetindo a cada 2 semanas às 8h30, de sex, 16/10 a sex, 27/11. Datas livres: 16/10, 30/10, 13/11, 27/11. Marco as 4 datas?");
  });
  it("adversarial: a recurrence the agenda does not create keeps the guard's one-option card; the flag off is exactly the guard", async () => {
    const daily = schedulingState();
    await applySchedulingInterpretation(actor, daily, { ...edgar, date: "2026-10-09", temporal_evidence: [{ field: "date", text: "dia 9" }, { field: "time", text: "oito e meia da manhã" }] }, "marca o Edgar todo dia a partir do dia 9 oito e meia da manhã, corte com a Nara");
    expect(daily.message).toMatch(/^Ainda não marco horários recorrentes pelo chat \(“todo dia”\)\. Marco só a primeira/);
    expect(daily.candidates?.items.map(item => item.id)).toEqual([FIRST_ONLY_REF]);
    vi.stubEnv("SALON_SECRETARY_RECURRING_SERIES", "false");
    const off = schedulingState();
    await applySchedulingInterpretation(actor, off, edgar, VIDEO);
    expect(off.message).toBe("Ainda não marco horários recorrentes pelo chat (“todas as sextas-feiras”). Informe data.");
    expect(off.fields.date).toBeUndefined();
    await expect(selectScheduling(actor, off, SERIES_REF)).rejects.toThrow("SELECTION_INVALID");
  });
  it("adversarial: a card option of another series, or an end not offered, is never accepted", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, edgar, VIDEO);
    await expect(selectScheduling(actor, c, `${SERIES_UNTIL_PREFIX}2027-01-01`)).rejects.toThrow("SELECTION_INVALID");
    await expect(selectScheduling(actor, c, "recurrence-all")).rejects.toThrow("SELECTION_INVALID");
    expect(db.proposed).toBe(0);
  });
  it("adversarial: after the series pick, the recurrence said again and then 'só a primeira' books ONE date (the series never lingers)", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, edgar, VIDEO);
    await selectScheduling(actor, c, SERIES_REF);
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create" }, "isso, toda sexta mesmo");
    expect(c.recurrence?.status).toBe("ASKED"); expect(c.fields.series).toBeUndefined(); expect(c.candidates?.items.map(item => item.id)).toContain(FIRST_ONLY_REF);
    await selectScheduling(actor, c, FIRST_ONLY_REF);
    expect(c.fields.series).toBeUndefined(); expect(db.snapshots.at(-1)?.series).toBeUndefined(); expect(db.proposed).toBe(2);
  });
  it("a series chosen and then moved past its end is dropped and asked again, never proposed with one date", async () => {
    const c = schedulingState();
    await applySchedulingInterpretation(actor, c, edgar, VIDEO);
    await selectScheduling(actor, c, SERIES_REF);
    expect(db.proposed).toBe(1);
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create", date: "2026-10-30", temporal_evidence: [{ field: "date", text: "dia 30" }] }, "na verdade começa dia 30");
    expect(c.fields.series).toBeUndefined(); expect(c.recurrence?.status).toBe("ASKED");
    expect(c.message).toMatch(/Até quando marco\?$/); expect(db.proposed).toBe(1);
  });
});
