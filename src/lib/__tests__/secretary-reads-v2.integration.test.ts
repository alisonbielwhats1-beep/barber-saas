import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { listSchedulingAppointments, listUpcomingCustomerAppointments, summarizeSchedulingAppointments } from "../scheduling-catalog";
import { availabilityAcross, upcomingAppointments } from "../secretary-reads";
import { applySchedulingInterpretation, schedulingState, type SchedulingState } from "../secretary-scheduling";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc } from "../time";

/** P3b (flag SALON_SECRETARY_READS_V2) on the local disposable PostgreSQL (coordinator only: RUN_SERVICE_MVP_INTEGRATION=1, the MVP
 * test database preflight). Read-only: C32 next appointments (0, 1, several; past and cancelled left out; another customer and
 * another tenant never shown), C29 the period filter before the row limit and the per-professional summary, C30/C31 the free
 * times of each eligible professional (one with no working hours has none). Synthetic barbershop "Navalha" and a second salon;
 * no network, no paid model, nothing written besides the journal draft. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
const tz = "America/Sao_Paulo";
const today = () => dateKeyInTimeZone(new Date(), tz);
async function fixture(name: string) {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: "Dono Sintético", email: `reads-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name, slug: `reads-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: tz } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const corte = await tx.service.create({ data: { salonId, name: "Corte masculino", durationMin: 15, priceCents: 4500 } });
    const pro = async (label: string, hours: boolean) => {
      const user = await tx.user.create({ data: { name: label, email: `reads-${label.split(" ")[0].toLowerCase()}-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      await tx.professionalService.create({ data: { serviceId: corte.id, professionalId: professional.id } });
      if (hours) await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
      return { id: professional.id, name: label };
    };
    const caio = await pro("Caio Brito", true), lia = await pro("Lia Moraes", true), nara = await pro("Nara Quintela", false);
    const maria = await tx.clientProfile.create({ data: { salonId, name: "Maria Eduarda Lopes" } });
    const hiroshi = await tx.clientProfile.create({ data: { salonId, name: "Hiroshi Tanaka" } });
    const staff = await tx.user.create({ data: { name: "Profissional Sintético", email: `reads-staff-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.membership.create({ data: { salonId, userId: staff.id, role: "PROFESSIONAL" } });
    return { actor: { salonId, userId: owner.id }, staff: { salonId, userId: staff.id }, corte, caio, lia, nara, maria, hiroshi };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function book(f: Fixture, client: { id: string }, professional: { id: string }, date: string, time: string, status: "PENDING" | "CONFIRMED" | "CANCELLED" = "CONFIRMED") {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
    const startAt = localDateTimeToUtc(`${date}T${time}`, tz), endAt = new Date(+startAt + 15 * 60_000);
    return tx.appointment.create({ data: { salonId: f.actor.salonId, clientId: client.id, professionalId: professional.id, serviceId: f.corte.id, startAt, endAt, timezone: tz, priceCents: 4500, status,
      serviceItems: { create: [{ serviceId: f.corte.id, position: 0, serviceName: "Corte masculino", durationMin: 15, priceCents: 4500 }] } } });
  });
}
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

suite("P3b reads on PostgreSQL (read-only, tenant scoped)", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => { console.log("READS_V2_PREFLIGHT", await assertMvpTestDatabase(admin)); vi.stubGlobal("fetch", network); });
  beforeEach(() => { vi.stubEnv("SALON_SECRETARY_READS_V2", "true"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin.$disconnect(); await prisma.$disconnect(); });

  it("C32: 0, 1 and several next appointments; past, cancelled, another customer and another tenant are never shown", async () => {
    const f = await fixture("Barbearia Navalha Sintética"), other = await fixture("Salão Outro Sintético");
    expect(await upcomingAppointments(f.actor, f.maria.id, {})).toEqual({ rows: [], more: false });
    await book(f, f.maria, f.caio, addCalendarDays(today(), -1), "10:00");
    await book(f, f.maria, f.lia, addCalendarDays(today(), 1), "10:00", "CANCELLED");
    await book(f, f.hiroshi, f.caio, addCalendarDays(today(), 1), "11:00");
    await book(other, other.maria, other.caio, addCalendarDays(today(), 1), "12:00");
    const first = await book(f, f.maria, f.lia, addCalendarDays(today(), 2), "10:00", "PENDING");
    expect((await upcomingAppointments(f.actor, f.maria.id, {})).rows.map(r => r.appointment_ref)).toEqual([first.id]);
    for (let day = 3; day <= 6; day++) await book(f, f.maria, day % 2 ? f.caio : f.lia, addCalendarDays(today(), day), "11:00");
    const next = await upcomingAppointments(f.actor, f.maria.id, {});
    expect(next.rows).toHaveLength(3); expect(next.more).toBe(true);
    expect(next.rows.every(r => r.customer_ref === f.maria.id && ["PENDING", "CONFIRMED"].includes(r.status))).toBe(true);
    expect((await upcomingAppointments(f.actor, f.maria.id, { professional_ref: f.lia.id })).rows.every(r => r.professional_ref === f.lia.id)).toBe(true);
    // Another tenant's customer (and appointment) through this salon's actor: nothing.
    expect(await withTenant(f.actor, tx => listUpcomingCustomerAppointments(tx, f.actor, other.maria.id, { take: 4 }))).toEqual([]);
    // PROFESSIONAL membership: refused as today.
    await expect(withTenant(f.staff, tx => listUpcomingCustomerAppointments(tx, f.staff, f.maria.id, { take: 4 }))).rejects.toThrow("FORBIDDEN");
    // Through the adapter: no day asked, nothing proposed.
    const state: SchedulingState = schedulingState();
    await applySchedulingInterpretation(f.actor, state, { operation: "appointment.list", customer_name: "Maria Eduarda" }, "quando é o próximo horário da Maria Eduarda?");
    expect(state.appointments).toHaveLength(3); expect(state.read_partial).toBe("UPCOMING"); expect(state.proposal).toBeUndefined();
  });

  it("C29: the period filter applies before the limit; above it a per-professional summary (cancellations apart)", async () => {
    const f = await fixture("Barbearia Navalha Sintética"), date = addCalendarDays(today(), 7);
    for (let i = 0; i < 30; i++) { await book(f, f.maria, f.caio, date, clock(240 + i * 15)); await book(f, f.hiroshi, f.lia, date, clock(240 + i * 15)); }
    for (let i = 0; i < 5; i++) await book(f, f.maria, f.nara, date, clock(840 + i * 15));
    await book(f, f.hiroshi, f.nara, date, "17:00", "CANCELLED");
    expect(await withTenant(f.actor, tx => listSchedulingAppointments(tx, f.actor, { date }))).toHaveLength(51);
    const afternoon = await withTenant(f.actor, tx => listSchedulingAppointments(tx, f.actor, { date, period: "afternoon" }));
    expect(afternoon).toHaveLength(6);
    const summary = await withTenant(f.actor, tx => summarizeSchedulingAppointments(tx, f.actor, { date }));
    expect(summary).toMatchObject({ total: 65, cancelled: 1, more: false, periods: { morning: 60, afternoon: 5, evening: 0 } });
    expect(summary.professionals.map(p => [p.professional_name, p.count])).toEqual([["Caio Brito", 30], ["Lia Moraes", 30], ["Nara Quintela", 5]]);
  });

  it("C30/C31: each eligible professional's free times (one without working hours has none); read-only", async () => {
    const f = await fixture("Barbearia Navalha Sintética"), date = addCalendarDays(today(), 8);
    await book(f, f.maria, f.caio, date, "12:00");
    const before = await withTenant(f.actor, tx => tx.appointment.count({ where: { salonId: f.actor.salonId } }));
    const rows = await availabilityAcross(f.actor, [f.caio, f.lia, f.nara], { service_ref: f.corte.id, date, period: "afternoon" });
    expect(rows.find(r => r.professional.id === f.caio.id)!.slots.map(s => s.startLocal)).not.toContain(`${date}T12:00`);
    expect(rows.find(r => r.professional.id === f.lia.id)!.slots[0].startLocal).toBe(`${date}T12:00`);
    expect(rows.find(r => r.professional.id === f.lia.id)!.more).toBe(true);
    expect(rows.find(r => r.professional.id === f.nara.id)!.slots).toEqual([]);
    expect(await withTenant(f.actor, tx => tx.appointment.count({ where: { salonId: f.actor.salonId } }))).toBe(before);
  });
});
