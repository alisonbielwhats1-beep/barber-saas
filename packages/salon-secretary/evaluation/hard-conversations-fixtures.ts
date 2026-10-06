/** Gate 4.0B: in-memory fixtures only. No Prisma client, seed, reset or executor. */
import { createHash } from "node:crypto";
import { conversationFixtures as spec } from "./hard-conversations";
import { findVisitPlan, type VisitDay } from "../../../src/lib/visit-scheduling";

export type FixtureName = keyof typeof spec.variants;
type Entity = { id: string; tenant: string; name: string; revision: number };
export type SyntheticFixture = {
  caseId: string; kind: FixtureName; tenant: string; foreignTenant: string; actor: string;
  baseTime: string; customers: (Entity & { contactEligible: boolean })[];
  professionals: Entity[];
  services: (Entity & { durationMin: number; priceCents: number; professionalIds: string[]; resourceId: string | null })[];
  products: (Entity & { stock: number; minStock: number })[];
  appointments: { id: string; tenant: string; customerId: string; professionalId: string; serviceId: string; startAt: string; endAt: string; status: "CONFIRMED"; revision: number }[];
  blocks: { professionalId: string; startAt: string; endAt: string }[];
  resources: { resourceId: string; startAt: string; endAt: string }[];
  searchComplete: boolean; journal: never[]; outbox: never[];
  fault: "NONE" | "SNAPSHOT_CHANGED" | "CANCELLATION_FAILED";
  financial: { metric: string; period: string; valueCents: number };
};
/** Reproducible UUIDs accepted by existing boundaries; not transmitted to a model. */
export function syntheticRef(caseId: string, key: string) {
  const h = createHash("sha256").update(`gate40b:${caseId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const at = (time: string) => `2026-10-06T${time}:00-03:00`;
export function makeFixture(caseId: string, kind: FixtureName): SyntheticFixture {
  if (!/^[iadtmx]\d{2}$/.test(caseId) || !Object.hasOwn(spec.variants, kind)) throw Error("INVALID_TEST_FIXTURE");
  const tenant = syntheticRef(caseId, "tenant-a"), foreignTenant = syntheticRef(caseId, "tenant-b");
  const entity = (name: string, type: string): Entity => ({ id: syntheticRef(caseId, `${type}:${name}`), tenant, name, revision: 1 });
  const professionals = spec.professionals.map(n => entity(n, "professional"));
  const fixture: SyntheticFixture = {
    caseId, kind, tenant, foreignTenant, actor: syntheticRef(caseId, "owner"), baseTime: spec.baseTime,
    professionals,
    customers: spec.customers.map(n => ({ ...entity(n, "customer"), contactEligible: n === "Amanda Souza" || n === "Amanda Ribeiro" })),
    services: spec.services.map(s => ({ ...entity(s.name, "service"), durationMin: s.durationMin, priceCents: s.priceCents,
      professionalIds: s.professionals.map(n => professionals.find(p => p.name === n)!.id), resourceId: null })),
    products: spec.products.map(p => ({ ...entity(p.name, "product"), stock: p.stock, minStock: p.minStock })),
    appointments: [], blocks: [], resources: [], searchComplete: true, journal: [], outbox: [], fault: "NONE",
    financial: { metric: spec.financialRead.metric, period: spec.financialRead.period, valueCents: spec.financialRead.expectedCents },
  };
  const appointment = (customer: string, professional: string, service: string, start: string, end: string) => {
    fixture.appointments.push({ id: syntheticRef(caseId, `appointment:${customer}:${start}`), tenant,
      customerId: fixture.customers.find(c => c.name === customer)!.id,
      professionalId: professionals.find(p => p.name === professional)!.id,
      serviceId: fixture.services.find(s => s.name === service)!.id, startAt: at(start), endAt: at(end), status: "CONFIRMED", revision: 1 });
  };
  if (kind === "approximate") fixture.services = fixture.services.filter(s => !["Corte Infantil", "Corte + Barba"].includes(s.name));
  if (kind === "no_customer") fixture.customers = fixture.customers.filter(c => c.name !== "Alisson");
  if (kind === "foreign") fixture.customers.find(c => c.name === "Alisson")!.tenant = foreignTenant;
  if (["two_amandas", "amanda_target", "dependent_failure", "occupied"].includes(kind)) appointment("Amanda Souza", "Tatiana", "Corte Completo", "10:00", "10:45");
  if (kind === "two_amandas") appointment("Amanda Ribeiro", "Ana Lima", "Massagem", "15:00", "16:00");
  if (kind === "insufficient_gap") appointment("Amanda Souza", "Tatiana", "Corte Infantil", "10:30", "11:00");
  if (kind === "resource_busy") {
    const resourceId = syntheticRef(caseId, "exclusive-resource");
    fixture.services.find(s => s.name === "Progressiva")!.resourceId = resourceId;
    fixture.resources.push({ resourceId, startAt: at("15:00"), endAt: at("17:00") });
  }
  if (kind === "professional_off") fixture.blocks.push({ professionalId: professionals[0].id, startAt: at("00:00"), endAt: at("23:59") });
  if (kind === "missing_contact") fixture.customers.find(c => c.name === "Amanda Souza")!.contactEligible = false;
  if (kind === "truncated") {
    fixture.searchComplete = false;
    fixture.customers.push(...Array.from({ length: 19 }, (_, i) => ({ ...entity(`Amanda Sintética ${i + 1}`, "customer"), contactEligible: false })));
  }
  if (kind === "changed_snapshot") fixture.fault = "SNAPSHOT_CHANGED";
  if (kind === "dependent_failure") fixture.fault = "CANCELLATION_FAILED";
  return fixture;
}

export function fixtureDigest(fixture: SyntheticFixture) {
  return createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
}

/** Tenant filter is explicit even in mocks; query matching mirrors current contains search. */
export function candidates(f: SyntheticFixture, kind: "customers" | "services" | "products", query: string) {
  return f[kind].filter(e => e.tenant === f.tenant && e.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
}

export function fixtureVisitDay(f: SyntheticFixture): VisitDay {
  const services = f.services.map(s => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceCents: s.priceCents,
    priceType: "FIXED", priceNote: null, physicalResourceId: s.resourceId,
    professionals: s.professionalIds.map(id => ({ professional: { id, user: { name: f.professionals.find(p => p.id === id)!.name } } })) }));
  return { salon: { timezone: spec.timezone, minBookingLeadMinutes: 0, maxBookingLeadDays: 60, bufferMinutes: 0 },
    services, priced: services, hours: new Map(f.professionals.map(p => [p.id, [{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 780, endMinutes: 1080 }]])),
    closures: [], blocks: f.blocks.map(b => ({ ...b, startAt: new Date(b.startAt), endAt: new Date(b.endAt) })),
    appointments: f.appointments.map(a => ({ ...a, startAt: new Date(a.startAt), endAt: new Date(a.endAt) })),
    resourceBookings: f.resources.map(r => ({ ...r, startAt: new Date(r.startAt), endAt: new Date(r.endAt) })), offers: [],
    preferences: { slotMode: "FIT", returnDays: 30, serviceReturnDays: {}, addons: {}, simultaneousPairs: [] },
    date: spec.relativeDates.tomorrow, now: new Date(f.baseTime) } as VisitDay;
}
export function available(f: SyntheticFixture, service: string, minute: number, professional?: string) {
  const s = f.services.find(s => s.name === service), p = f.professionals.find(p => p.name === professional);
  if (!s || (professional && !p)) return false;
  return findVisitPlan(fixtureVisitDay(f), [{ serviceId: s.id, ...(p ? { professionalId: p.id } : {}) }], minute) !== null;
}

export function validateFixture(f: SyntheticFixture): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, code: string) => { if (!ok) errors.push(code); };
  need(f.baseTime === spec.baseTime, "BASE_TIME");
  const entities = [...f.customers, ...f.services, ...f.products, ...f.professionals];
  need(new Set(entities.map(e => e.id)).size === entities.length, "DUPLICATE_ID");
  need(entities.every(e => e.tenant === f.tenant || (f.kind === "foreign" && e.tenant === f.foreignTenant && e.name === "Alisson")), "CROSS_TENANT");
  need(f.services.every(s => s.professionalIds.every(id => f.professionals.some(p => p.id === id)) && s.durationMin >= 5), "SERVICE_PROFESSIONAL");
  need(f.appointments.every(a => a.tenant === f.tenant && a.status === "CONFIRMED" && a.revision === 1 &&
    f.customers.some(c => c.id === a.customerId && c.tenant === f.tenant) && f.services.some(s => s.id === a.serviceId && s.professionalIds.includes(a.professionalId)) && Date.parse(a.endAt) > Date.parse(a.startAt)), "APPOINTMENT_RELATION");
  need(f.journal.length === 0 && f.outbox.length === 0, "NOT_FRESH");
  need(f.products.find(p => p.name === "Shampoo X")?.stock === 4 && f.financial.valueCents === 12000, "READ_FIXTURE");
  need(candidates(f, "customers", "Alisson").length === (["no_customer", "foreign"].includes(f.kind) ? 0 : 1), "ALISSON");
  if (f.kind === "approximate") need(candidates(f, "services", "corte").length === 1 && candidates(f, "services", "corte")[0].name === "Corte Completo", "APPROXIMATION");
  if (f.kind === "many_cuts") need(candidates(f, "services", "corte").length === 3, "CUT_AMBIGUITY");
  if (f.kind === "truncated") need(candidates(f, "customers", "Amanda").length === 21 && !f.searchComplete, "TRUNCATION");
  if (f.kind === "two_amandas") need(f.appointments.length === 2, "AMANDA_AMBIGUITY");
  if (["occupied", "insufficient_gap"].includes(f.kind)) {
    need(!available(f, "Corte Completo", 600, "Tatiana"), "INTERVAL_CONFLICT");
    const slots = f.kind === "occupied" ? [645, 660, 675] : [660, 675, 780];
    need(slots.every(m => available(f, "Corte Completo", m, "Tatiana")), "ALTERNATIVES");
  }
  if (["resource_busy", "professional_off"].includes(f.kind)) need(!available(f, "Progressiva", 900, "Tatiana"), "BLOCK_CONFLICT");
  if (f.kind === "multiple_professionals") need(["Tatiana", "Ana Lima"].every(p => available(f, "Corte Infantil", 900, p)), "MULTIPLE_PROFESSIONALS");
  if (f.kind === "missing_contact") need(!f.customers.find(c => c.name === "Amanda Souza")!.contactEligible, "MISSING_CONTACT");
  if (f.kind === "changed_snapshot") need(f.fault === "SNAPSHOT_CHANGED", "STALE_SNAPSHOT_HOOK");
  if (f.kind === "dependent_failure") need(f.fault === "CANCELLATION_FAILED", "DEPENDENCY_FAILURE_HOOK");
  return errors;
}
