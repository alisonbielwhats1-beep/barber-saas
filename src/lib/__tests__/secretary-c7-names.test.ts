import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { directorySubsetProof, nameInText, rankNameSuggestions, sameName, withoutArticle, withoutHonorific } from "../name-search";
import { searchSalonCustomer } from "../customer-catalog";
import { listSchedulingProfessionals } from "../scheduling-catalog";
import { existingBookings } from "../scheduling-actions";
import { existingBookingNotice } from "../secretary-display";
import { validateExampleBank, structureJaccard, CONTAMINATION_FRAME_TOKENS } from "../../../packages/salon-secretary/src/examples/validate";
import { maskedTokens } from "../../../packages/salon-secretary/evaluation/agenda-practice-stats";
import type { BankExample } from "../../../packages/salon-secretary/src/examples/bank";
import { fillExample, type ExampleFills } from "../../../packages/salon-secretary/src/examples/fill";
import { RouterTrace } from "../secretary-router";
import { turnBaseline, turnOutcome } from "../secretary-turn-outcome";

/** C7 structural fixes (pure parts): directory subset proof, articles and honorifics in names, the create-vs-change
 * notice, the example bank's structure-level anti-contamination and the N12 harness answer. No network, no database. */
describe("directory subset proof (a name Luna expanded from the owner's words)", () => {
  const salon = ["Rodrigo Lima", "Tatiana Rocha", "Ricardo Alves"];
  it("proves the directory name when the owner's tokens single out exactly that entry", () => {
    expect(directorySubsetProof("Rodrigo Lima", "fecha a agenda do rodrigo das 15h as 16h", salon)).toBe(true);
    expect(directorySubsetProof("Ricardo Alves", "marca o joao amanha as 11h pra corte com o ricardo", salon)).toBe(true);
    expect(directorySubsetProof("Tatiana Rocha", "bloqueia a tatiana amanha", salon)).toBe(true);
  });
  it("never picks among entries that share the owner's tokens, nor proves a typo or a name the text lacks", () => {
    expect(directorySubsetProof("Rodrigo Lima", "fecha a agenda do rodrigo", [...salon, "Rodrigo Alves"])).toBe(false);
    expect(directorySubsetProof("Tatiana Rocha", "bloqueia a tatiane amanha", salon)).toBe(false);
    expect(directorySubsetProof("Rodrigo Lima", "fecha a agenda amanha", salon)).toBe(false);
    // The unique holder must be the name itself: a longer entry never proves a shorter claim, and vice versa.
    expect(directorySubsetProof("Rodrigo Lima", "fecha o rodrigo", ["Rodrigo Lima Neto"])).toBe(false);
    expect(directorySubsetProof("Rodrigo", "fecha o rodrigo", ["Rodrigo Lima"])).toBe(false);
    expect(directorySubsetProof("Rodrigo Lima", "fecha o rodrigo", [])).toBe(false);
  });
  it("reads exact folded tokens (accents and case ignored, never a prefix or a substring)", () => {
    expect(directorySubsetProof("Fábio Santos", "passa o FABIO pra sexta", ["Fábio Santos", "Tatiana Rocha"])).toBe(true);
    expect(directorySubsetProof("Fábio Santos", "passa o fab pra sexta", ["Fábio Santos"])).toBe(false);
    expect(directorySubsetProof("Ana Souza", "marca a mariana", ["Ana Souza"])).toBe(false);
  });
});

describe("articles and honorifics in person names", () => {
  it("a leading article is never part of the name; an honorific is separable but only when something follows", () => {
    expect(withoutArticle("a carla")).toBe("carla"); expect(withoutArticle("O Rodrigo")).toBe("Rodrigo"); expect(withoutArticle("a Dona Cida")).toBe("Dona Cida");
    expect(withoutArticle("Ana Souza")).toBe("Ana Souza"); expect(withoutArticle("a")).toBe("a"); expect(withoutArticle("a b")).toBe("a b");
    expect(withoutHonorific("dona cida")).toBe("cida"); expect(withoutHonorific("Sr. João")).toBe("João"); expect(withoutHonorific("seu joaquim")).toBe("joaquim");
    expect(withoutHonorific("Cida Souza")).toBeUndefined(); expect(withoutHonorific("dona")).toBeUndefined();
  });
  it("name proof and option echoes ignore the article but never an honorific the owner did not say", () => {
    expect(nameInText("a carla", "cancela a rosa, nao pera, a carla, ela ta doente")).toBe(true);
    expect(nameInText("a Carla", "cancela a Carla")).toBe(true);
    expect(nameInText("Dona Cida", "marca a cida amanha")).toBe(false);
    expect(nameInText("dona cida", "marca a dona cida amanha")).toBe(true);
    expect(sameName("a Amanda Souza", "Amanda Souza")).toBe(true);
    expect(sameName("Dona Maria", "Maria")).toBe(false);
  });
  it("suggestions score the name itself: no leading article, no required honorific", () => {
    const rows = [{ id: "c1", name: "Carla Mendes" }, { id: "c2", name: "Cida Souza" }];
    expect(rankNameSuggestions("a carla", rows)).toEqual({ status: "SUGGEST", rows: [rows[0]] });
    expect(rankNameSuggestions("dona cida", rows)).toEqual({ status: "SUGGEST", rows: [rows[1]] });
  });
});

describe("catalog searches (fake tenant transaction)", () => {
  const io = { customers: [] as { id: string; salonId: string; name: string; phone: string | null; mergedIntoId: string | null }[], professionals: [] as { id: string; name: string }[], asked: [] as string[] };
  const tx = {
    $queryRaw: vi.fn(async (parts: readonly string[]) => { const sql = parts.join("?"); return sql.includes('"Membership"') ? [{ role: "OWNER" }] : sql.includes('"Salon"') ? [{ accessStatus: "APPROVED" }] : []; }),
    clientProfile: { findMany: vi.fn(async ({ where }: { where: { salonId: string; OR: Record<string, { contains?: string }>[] } }) => {
      const term = where.OR.find(q => q.name)?.name.contains;if (term) io.asked.push(term);
      return io.customers.filter(row => row.salonId === where.salonId && !row.mergedIntoId && term && row.name.toLowerCase().includes(term.toLowerCase())).map(({ id, name, phone }) => ({ id, name, phone })); }) },
    professional: { findMany: vi.fn(async ({ where }: { where: { user?: { name: { contains: string } }; OR?: { user?: { name: { contains: string } } }[] } }) => {
      const term = where.user?.name.contains ?? where.OR?.find(q => q.user)?.user?.name.contains;if (term) io.asked.push(term);
      return io.professionals.filter(row => !term || row.name.toLowerCase().includes(term.toLowerCase())).map(row => ({ id: row.id, user: { name: row.name } })); }) },
  } as unknown as Tx;
  const actor = { salonId: "ours", userId: "owner" };
  beforeEach(() => {
    vi.clearAllMocks(); io.asked.length = 0; vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
    io.customers = [{ id: "carla", salonId: "ours", name: "Carla Mendes", phone: null, mergedIntoId: null }, { id: "anacarla", salonId: "ours", name: "Ana Carla", phone: null, mergedIntoId: null },
      { id: "cida", salonId: "ours", name: "Cida Souza", phone: null, mergedIntoId: null }, { id: "foreign", salonId: "theirs", name: "Cida Lima", phone: null, mergedIntoId: null }];
    io.professionals = [{ id: "rodrigo", name: "Rodrigo Lima" }];
  });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  it("'a carla' is searched as 'carla': both Carlas are options (before, '%a carla%' matched only 'Ana Carla')", async () => {
    expect((await searchSalonCustomer(tx, actor, "a carla")).map(row => row.id)).toEqual(["carla", "anacarla"]);
    expect(io.asked).toEqual(["carla"]);
  });
  it("an honorific is searched as written first and dropped only when nothing matches; tenant scope is unchanged", async () => {
    expect((await searchSalonCustomer(tx, actor, "dona cida")).map(row => row.id)).toEqual(["cida"]);
    expect(io.asked).toEqual(["dona cida", "cida"]);
    io.asked.length = 0; io.customers.push({ id: "dona", salonId: "ours", name: "Dona Cida", phone: null, mergedIntoId: null });
    expect((await searchSalonCustomer(tx, actor, "dona cida")).map(row => row.id)).toEqual(["dona"]);
    expect(io.asked).toEqual(["dona cida"]);
    io.asked.length = 0;
    expect(await searchSalonCustomer(tx, actor, "seu cid")).toHaveLength(2); // "cid" alone: several rows stay a question
    expect(await searchSalonCustomer(tx, actor, "dona lima")).toEqual([]); // the other salon's Cida Lima never appears
  });
  it("names without an article or honorific keep exactly one query, as before", async () => {
    await searchSalonCustomer(tx, actor, "Carla Mendes"); expect(io.asked).toEqual(["Carla Mendes"]);
    await expect(searchSalonCustomer(tx, actor, "rita@")).rejects.toThrow("INVALID_EMAIL_REFERENCE");
  });
  it("professionals: 'o rodrigo' is 'rodrigo'", async () => {
    expect(await listSchedulingProfessionals(tx, actor, { query: "o rodrigo" })).toEqual([{ id: "rodrigo", name: "Rodrigo Lima" }]);
    expect(io.asked).toEqual(["rodrigo"]);
  });
});

describe("create vs change: a NEW booking for someone who already has one says so", () => {
  const row = (ref: string, local: string, minutes = 60) => { const start = new Date(`${local}:00-03:00`); return { appointment_ref: ref, start_local: local, start_at: start.toISOString(), end_at: new Date(start.getTime() + minutes * 60000).toISOString() }; };
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2027-06-14T12:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  // Review migration (backup: .demo/agenda-core/contract-migration/secretary-c7-names.test.before-notice-review.ts): the
  // notice left the proposal preview (the model's context) for a screen-only rendering beside it, with pt-BR wording and
  // no directive; appointments another action of the plan cancels or moves are not listed.
  it("lists the upcoming appointment(s), overlapping first and marked, and never asks anything", () => {
    expect(existingBookingNotice("Fábio Santos", [])).toBe("");
    expect(existingBookingNotice("Fábio Santos", existingBookings([row("a", "2027-06-16T16:00")])))
      .toBe("\nAtenção: Fábio Santos já tem horário marcado: qua, 16/06 às 16h. Isto cria um novo agendamento; para mudar o existente, peça para remarcar.");
    const slot = { start: new Date("2027-06-18T13:30:00Z"), end: new Date("2027-06-18T14:30:00Z") }; // 10h30–11h30 local
    const overlapping = row("b", "2027-06-18T10:00"), later = row("c", "2027-06-20T09:00"), last = row("d", "2027-06-25T09:00");
    const found = existingBookings([overlapping, row("a", "2027-06-16T16:00"), overlapping, later, last], slot);
    expect(found.map(item => [item.appointment_ref, item.overlaps])).toEqual([["b", true], ["a", false], ["c", false], ["d", false]]);
    expect(existingBookingNotice("Fábio Santos", found))
      .toBe("\nAtenção: Fábio Santos já tem horários marcados: sex, 18/06 às 10h (mesmo horário) e qua, 16/06 às 16h, entre outros. Isto cria um novo agendamento; para mudar o existente, peça para remarcar.");
    // An appointment another action of the same plan cancels or moves is not listed.
    expect(existingBookingNotice("Fábio Santos", found, new Set(["b", "c", "d"])))
      .toBe("\nAtenção: Fábio Santos já tem horário marcado: qua, 16/06 às 16h. Isto cria um novo agendamento; para mudar o existente, peça para remarcar.");
    expect(existingBookingNotice("Fábio Santos", found, new Set(["a", "b", "c", "d"]))).toBe("");
  });
});

describe("example bank: structure-level anti-contamination and name hygiene", () => {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "packages/salon-secretary/src/examples/bank.json"), "utf8")) as BankExample[];
  // G1 migration (backup: .demo/agenda-core/contract-migration/secretary-c7-names.test.before-g1.ts): the bank carries
  // name/service placeholders now; the pinned entries are filled with the names they had (same text as before).
  const FORMER: Record<string, ExampleFills> = {
    S001: { people: { cliente: { given: "julia" }, profissional: { given: "tati", nickname: "tati" } }, services: { servico: "escova" } },
    R058: { people: { profissional: { given: "lia" }, cliente: { given: "Duda", nickname: "Duda" }, cliente2: { given: "Beto", nickname: "Beto" } }, services: {} },
  };
  const byId = (id: string) => { const entry = structuredClone(raw.find(example => example.id === id)!); return FORMER[id] ? fillExample(entry, FORMER[id]) : entry; };
  const codes = (entry: unknown, corpus: { source: string; text: string }[] = []) => validateExampleBank([entry], { corpus, wires: ["legacy"] }).issues;
  it("renaming the people or moving the hour does not hide a copied sentence (names, digits and weekdays masked)", () => {
    const s001 = byId("S001"); // "poe a julia na escova amanha 10h com a tati"
    const copied = [{ source: "battery.json#X01", text: "poe a carla na escova amanha 9h com a tatiana" }];
    expect(codes(s001, copied)).toEqual([{ id: "S001", code: "CONTAMINATION", detail: "battery.json#X01 jaccard=1.00" }]);
    expect(JSON.stringify(codes(s001, copied))).not.toMatch(/carla|tatiana|julia/);
    expect(codes(s001, [{ source: "battery.json#X02", text: "a tatiana tem horario livre sexta de tarde pra coloracao?" }])).toEqual([]);
  });
  it("short replies below the frame size are compared by the plain Jaccard only", () => {
    const names = new Set(["lia", "rita"]);
    expect(CONTAMINATION_FRAME_TOKENS).toBe(5);
    expect(structureJaccard(maskedTokens("com a lia", names), maskedTokens("com a rita", names))).toBe(0);
    const r058 = byId("R058"); expect(r058.message).toBe("com a lia");
    expect(codes(r058, [{ source: "battery.json#X03", text: "com a rita" }])).toEqual([]);
  });
  it("no example names a person of the evaluation fixtures or batteries, and none keeps an article in a name", () => {
    const s001 = byId("S001");
    s001.message = "poe a carla na escova amanha 10h com a tati"; s001.expected.operations[0].customer_name = { value: "carla", literal: "carla" };
    expect(codes(s001)).toEqual([{ id: "S001", code: "EVALUATION_NAME", detail: "1" }]);
    const article = byId("S001"); article.expected.operations[0].customer_name = { value: "a julia", literal: "a julia" };
    expect(codes(article).map(issue => issue.code)).toContain("NAME_WITH_ARTICLE");
    const honorific = byId("S001"); honorific.message = "poe a dona julia na escova amanha 10h com a tati"; honorific.expected.operations[0].customer_name = { value: "dona julia", literal: "dona julia" };
    expect(codes(honorific)).toEqual([]);
    for (const example of raw) for (const op of example.expected.operations) for (const key of ["customer_name", "professional_name", "target_name"] as const)
      expect(/^(?:a|o|as|os)\s/i.test(op[key]?.value ?? ""), `${example.id}.${key}`).toBe(false);
  });
});

describe("telemetry: the directory proof is a boolean code, sanitized in the router row", () => {
  it("keeps directory_proof only when it is exactly true and the role is closed (service only for that proof)", () => {
    const session = { id: "session", skill: "auto", capability_status: "CONVERSATION" }, trace = new RouterTrace();
    const outcome = turnOutcome(session, turnBaseline(session, () => undefined), trace, { view: { message: "Oi" } as never }, { salt: () => "salt", previous: [] }).outcome;
    trace.outcome = { ...outcome, name_checks: [{ role: "service", in_message: false, option_echo: false, directory_proof: true },
      { role: "professional", in_message: false, option_echo: false, directory_proof: "Rodrigo Lima" as never }, { role: "Rodrigo" as never, in_message: true, option_echo: false }] };
    expect(trace.snapshot().outcome?.name_checks).toEqual([{ role: "service", in_message: false, option_echo: false, directory_proof: true },
      { role: "professional", in_message: false, option_echo: false }]);
    expect(JSON.stringify(trace.snapshot())).not.toMatch(/rodrigo/i);
  });
});

describe("N12 (dev battery): harness answer for the legitimate appointment question, oracle unchanged", () => {
  it("answers appointment_ref like customer_ref; the final oracle and mustAsk stay as they were", () => {
    const n12 = (JSON.parse(readFileSync(join(process.cwd(), "packages/salon-secretary/evaluation/agenda-practice-natural.json"), "utf8")) as { id: string; answers: Record<string, string[]>; final: unknown }[]).find(s => s.id === "N12")!;
    expect(n12.answers).toEqual({ customer_ref: ["o fabio santos", "fabio santos", "é o fabio santos"], appointment_ref: ["o fabio santos", "fabio santos", "é o fabio santos"] });
    expect(n12.final).toEqual({ appointments: [{ customer: "Fábio Santos", service: "Barba", day: "sex", time: "16:00", professional: "Ricardo Alves", status: "CONFIRMED" }],
      mustAsk: ["customer_ref", "appointment_ref", "selection"] });
  });
});
