import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** P3b read queries (flag SALON_SECRETARY_READS_V2 decides only whether the adapter passes the new inputs; the queries are
 * checked here directly). Tenant scope and the access check are the historical ones: every query carries the actor's salonId
 * and a PROFESSIONAL membership (or an unapproved salon) is refused before anything is read. Offline fake transaction. */
const db = vi.hoisted(() => ({ access: "APPROVED", role: "OWNER", rows: [] as Record<string, unknown>[], found: [] as unknown[] }));
vi.mock("../visit-scheduling", async importOriginal => ({ ...await importOriginal<object>(),
  loadVisitDay: async () => ({ salon: { timezone: "America/Sao_Paulo" }, closures: [] }),
  findVisitPlan: (_day: unknown, _choices: unknown, minute: number) => ({ startLocal: `2026-10-01T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, endLocal: "2026-10-01T23:59", items: [] }),
  visitQuote: () => null }));
import { getSchedulingAvailability, listSchedulingAppointments, listUpcomingCustomerAppointments, summarizeSchedulingAppointments } from "../scheduling-catalog";

const actor = { salonId: "salon-a", userId: "user-a" };
let findMany: import("vitest").Mock<(args: { take: number }) => Promise<unknown>>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  Object.assign(db, { access: "APPROVED", role: "OWNER", rows: [] });
  findMany = vi.fn(async (args: { take: number }) => db.rows.slice(0, args.take));
  db.found = [];
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const tx = () => ({
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => strings.join("?").includes("accessStatus") ? [{ accessStatus: db.access }] : [{ role: db.role }]),
  salon: { findUniqueOrThrow: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })) },
  professional: { findFirst: vi.fn(async () => ({ id: "pro-1" })) },
  service: { findFirst: vi.fn(async () => ({ id: "s-1" })), findFirstOrThrow: vi.fn(async () => ({ physicalResourceId: null })) },
  appointment: { findMany: (args: { take: number }) => findMany(args) },
}) as unknown as Tx;
const utc = (iso: string) => new Date(iso);
const whereOf = (call = 0) => (findMany.mock.calls[call][0] as unknown as { where: Record<string, unknown> }).where;

describe("day read window: the clock/period filter is part of the query (before the limit)", () => {
  it("without a filter the historical query: the salon's whole local day, 51 rows", async () => {
    await listSchedulingAppointments(tx(), actor, { date: "2026-09-30" });
    const args = findMany.mock.calls[0][0] as { where: unknown; take: number; orderBy: unknown };
    expect(args.where).toEqual({ salonId: "salon-a", startAt: { gte: utc("2026-09-30T03:00:00Z"), lt: utc("2026-10-01T03:00:00Z") } });
    expect(Object.keys(args.where as object)).toEqual(["salonId", "startAt"]);
    expect(args.take).toBe(51); expect(args.orderBy).toEqual([{ startAt: "asc" }, { id: "asc" }]);
  });
  it("periods use the matchesSchedulingPeriod boundaries in the salon's timezone; a clock is that start minute", async () => {
    for (const period of ["morning", "afternoon", "evening"] as const) await listSchedulingAppointments(tx(), actor, { date: "2026-09-30", period });
    await listSchedulingAppointments(tx(), actor, { date: "2026-09-30", time: "15:30", professional_ref: "pro-1" });
    expect(whereOf(0).startAt).toEqual({ gte: utc("2026-09-30T03:00:00Z"), lt: utc("2026-09-30T15:00:00Z") });
    expect(whereOf(1).startAt).toEqual({ gte: utc("2026-09-30T15:00:00Z"), lt: utc("2026-09-30T21:00:00Z") });
    expect(whereOf(2).startAt).toEqual({ gte: utc("2026-09-30T21:00:00Z"), lt: utc("2026-10-01T03:00:00Z") });
    expect(whereOf(3)).toEqual({ salonId: "salon-a", startAt: { gte: utc("2026-09-30T18:30:00Z"), lt: utc("2026-09-30T18:31:00Z") }, professionalId: "pro-1" });
  });
  it("an unknown filter key or a malformed clock is refused (strict input)", async () => {
    await expect(listSchedulingAppointments(tx(), actor, { date: "2026-09-30", period: "night" })).rejects.toThrow();
    await expect(listSchedulingAppointments(tx(), actor, { date: "2026-09-30", time: "25:00" })).rejects.toThrow();
    await expect(listSchedulingAppointments(tx(), actor, { date: "2026-09-30", salonId: "salon-b" })).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("day summary: counted, never listed", () => {
  const row = (pro: string, name: string, local: string, status = "CONFIRMED") => ({ startAt: new Date(`${local}:00-03:00`), timezone: "America/Sao_Paulo", status, professionalId: pro, professional: { user: { name } } });
  it("per professional (count, first and last start) and per period; cancellations apart; same tenant where", async () => {
    db.rows = [row("p-kai", "Kai Tanaka", "2026-09-30T08:00"), row("p-bia", "Bia Duarte", "2026-09-30T09:30"), row("p-kai", "Kai Tanaka", "2026-09-30T13:00"),
      row("p-kai", "Kai Tanaka", "2026-09-30T18:30"), row("p-bia", "Bia Duarte", "2026-09-30T19:00", "CANCELLED"), row("p-bia", "Bia Duarte", "2026-09-30T12:00", "NO_SHOW")];
    const summary = await summarizeSchedulingAppointments(tx(), actor, { date: "2026-09-30", service_ref: "s-1" });
    expect(summary).toEqual({ total: 5, cancelled: 1, more: false, periods: { morning: 2, afternoon: 2, evening: 1 }, professionals: [
      { professional_ref: "p-kai", professional_name: "Kai Tanaka", count: 3, first_local: "2026-09-30T08:00", last_local: "2026-09-30T18:30" },
      { professional_ref: "p-bia", professional_name: "Bia Duarte", count: 2, first_local: "2026-09-30T09:30", last_local: "2026-09-30T12:00" }] });
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown>; take: number; select: Record<string, unknown> };
    expect(args.where).toMatchObject({ salonId: "salon-a", OR: [{ serviceId: "s-1" }, { serviceItems: { some: { serviceId: "s-1" } } }] });
    expect(args.take).toBe(1001);
    // Names of professionals only: no customer is read.
    expect(Object.keys(args.select).sort()).toEqual(["professional", "professionalId", "startAt", "status", "timezone"]);
  });
  it("bounded: over 1000 rows is said as more, never counted as the total", async () => {
    db.rows = Array.from({ length: 1001 }, () => row("p-kai", "Kai Tanaka", "2026-09-30T10:00"));
    const summary = await summarizeSchedulingAppointments(tx(), actor, { date: "2026-09-30" });
    expect(summary).toMatchObject({ total: 1000, more: true });
  });
});

describe("a customer's next appointments: optional professional/service filters", () => {
  it("no filter: the historical query (future PENDING/CONFIRMED of that customer in the tenant)", async () => {
    await listUpcomingCustomerAppointments(tx(), actor, "c-1", { take: 4 });
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown>; take: number };
    expect(args.where).toEqual({ salonId: "salon-a", clientId: "c-1", status: { in: ["PENDING", "CONFIRMED"] }, startAt: { gt: utc("2026-09-29T15:00:00Z") } });
    expect(args.take).toBe(4);
  });
  it("with filters: the professional and ANY service of the appointment", async () => {
    await listUpcomingCustomerAppointments(tx(), actor, "c-1", { take: 4, professional_ref: "pro-9", service_ref: "s-9" });
    expect(whereOf()).toEqual({ salonId: "salon-a", clientId: "c-1", status: { in: ["PENDING", "CONFIRMED"] }, startAt: { gt: utc("2026-09-29T15:00:00Z") },
      professionalId: "pro-9", OR: [{ serviceId: "s-9" }, { serviceItems: { some: { serviceId: "s-9" } } }] });
  });
});

describe("permissions unchanged: refused before any read", () => {
  it.each([["PROFESSIONAL", "APPROVED"], ["OWNER", "PENDING"]])("role %s in a %s salon", async (role, access) => {
    Object.assign(db, { role, access });
    await expect(listSchedulingAppointments(tx(), actor, { date: "2026-09-30", period: "afternoon" })).rejects.toThrow("FORBIDDEN");
    await expect(summarizeSchedulingAppointments(tx(), actor, { date: "2026-09-30" })).rejects.toThrow("FORBIDDEN");
    await expect(listUpcomingCustomerAppointments(tx(), actor, "c-1", { professional_ref: "pro-1" })).rejects.toThrow("FORBIDDEN");
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("availability: how many alternatives are looked for", () => {
  it("every historical caller keeps 5; an availability read may ask one more (to say 'há mais')", async () => {
    const input = { service_ref: "s-1", professional_ref: "pro-1", date: "2026-10-01" };
    expect((await getSchedulingAvailability(tx(), actor, input)).alternatives).toHaveLength(5);
    expect((await getSchedulingAvailability(tx(), actor, input, undefined, undefined, undefined, 6)).alternatives).toHaveLength(6);
  });
});
