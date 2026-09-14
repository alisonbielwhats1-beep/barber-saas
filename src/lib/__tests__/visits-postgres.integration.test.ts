import { describe, it, expect } from "vitest";
import { prisma } from "../prisma";
import { writeAuditLog } from "../audit";
import { withSalon } from "../prisma-tenant";
import { assertSafeDatabaseOperation } from "../database-safety";
import {
  createVisit,
  findVisitPlan,
  loadVisitDay,
  visitQuote,
  visitGroupsForAppointments,
} from "../visit-scheduling";
import { createAppointment } from "../appointment-service";
import {
  requestStaffReschedule,
  respondToRescheduleProposal,
} from "../reschedule-proposals";
import { dateKeyInTimeZone, addCalendarDays } from "../time";
const pg =
  process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
async function fixture() {
  assertSafeDatabaseOperation(process.env, { operation: "visits-integration" });
  const suffix = crypto.randomUUID();
  const salon = await prisma.salon.create({
    data: {
      slug: `visits-${suffix}`,
      name: "Visita sintética",
      plan: "PRO",
      accessStatus: "APPROVED",
      timezone: "America/Sao_Paulo",
      bufferMinutes: 0,
      minBookingLeadMinutes: 0,
    },
  });
  const date = addCalendarDays(
    dateKeyInTimeZone(new Date(), salon.timezone),
    3,
  );
  const users = await Promise.all(
    [0, 1].map((i) =>
      prisma.user.create({
        data: {
          email: `${suffix}-${i}@example.test`,
          name: `Profissional ${i}`,
          passwordHash: "test-only",
        },
      }),
    ),
  );
  const pros = await Promise.all(
    users.map((u) =>
      prisma.professional.create({ data: { salonId: salon.id, userId: u.id } }),
    ),
  );
  const services = await Promise.all(
    pros.map((p, i) =>
      prisma.service.create({
        data: {
          salonId: salon.id,
          name: `Serviço ${i}`,
          durationMin: 30,
          priceCents: 5000 + i * 1000,
          professionals: { create: { professionalId: p.id } },
        },
      }),
    ),
  );
  await prisma.professionalOpening.createMany({
    data: pros.map((p) => ({
      salonId: salon.id,
      professionalId: p.id,
      dateKey: date,
      startMinutes: 540,
      endMinutes: 1260,
      reason: "Teste",
    })),
  });
  const client = await prisma.clientProfile.create({
    data: {
      salonId: salon.id,
      name: "Cliente sintético",
      email: `${suffix}@example.test`,
      passwordHash: "test-only",
    },
  });
  const choices = services.map((s, i) => ({
    serviceId: s.id,
    professionalId: pros[i]!.id,
  }));
  const base = {
    salonId: salon.id,
    clientId: client.id,
    choices,
    startLocal: `${date}T15:00`,
    actor: { type: "CLIENT" as const, id: client.id, name: client.name },
    idempotencyKey: crypto.randomUUID(),
  };
  return { salon, date, users, pros, services, client, choices, base };
}
pg("visitas transacionais com PostgreSQL real", () => {
  it("ledger funciona com SELECT/INSERT e RLS, sem leitura cruzada ou alteração do histórico", async () => {
    const f = await fixture(),
      other = await fixture();
    const role = "app_visit_ledger_ci";
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`,
    );
    try {
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await prisma.$executeRawUnsafe(
        `GRANT SELECT, INSERT ON "AuditLog" TO ${role}`,
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY',
      );
      await prisma.$executeRawUnsafe(
        'DROP POLICY IF EXISTS tenant_isolation ON "AuditLog"',
      );
      await prisma.$executeRawUnsafe(
        'CREATE POLICY tenant_isolation ON "AuditLog" USING ("salonId" = app_current_salon()) WITH CHECK ("salonId" = app_current_salon())',
      );
      await withSalon(f.salon.id, async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        await writeAuditLog(tx, {
          salonId: f.salon.id,
          userId: null,
          actorName: "Cliente",
          action: "VISIT_CREATED",
          entityType: "Visit",
          entityId: "synthetic-visit",
          metadata: { appointmentIds: ["synthetic-appointment"] },
        });
        expect(
          await visitGroupsForAppointments(tx, f.salon.id, [
            "synthetic-appointment",
          ]),
        ).toEqual({ "synthetic-appointment": "synthetic-visit" });
      });
      await withSalon(other.salon.id, async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        expect(
          await visitGroupsForAppointments(tx, f.salon.id, [
            "synthetic-appointment",
          ]),
        ).toEqual({});
      });
      await expect(
        withSalon(f.salon.id, async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          await tx.auditLog.deleteMany({
            where: { salonId: f.salon.id, action: "VISIT_CREATED" },
          });
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`DROP OWNED BY ${role}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
  });
  it("grava ambos, agrupa por cliente e replay concorrente não duplica eventos", async () => {
    const f = await fixture();
    const results = await Promise.all([
      withSalon(f.salon.id, (tx) => createVisit(tx, f.base)),
      withSalon(f.salon.id, (tx) => createVisit(tx, f.base)),
    ]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect(results[0]!.appointmentIds).toEqual(results[1]!.appointmentIds);
    expect(
      await prisma.appointment.count({ where: { salonId: f.salon.id } }),
    ).toBe(2);
    expect(
      await prisma.appointmentEvent.count({
        where: { salonId: f.salon.id, eventType: "CREATED" },
      }),
    ).toBe(2);
    const groups = await withSalon(f.salon.id, (tx) =>
      visitGroupsForAppointments(tx, f.salon.id, results[0]!.appointmentIds),
    );
    expect(Object.values(groups)).toEqual([
      f.base.idempotencyKey,
      f.base.idempotencyKey,
    ]);
    const other = await fixture();
    expect(
      await withSalon(other.salon.id, (tx) =>
        visitGroupsForAppointments(
          tx,
          other.salon.id,
          results[0]!.appointmentIds,
        ),
      ),
    ).toEqual({});
    await expect(
      withSalon(f.salon.id, (tx) =>
        createVisit(tx, { ...f.base, startLocal: `${f.date}T16:00` }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });
  it("falha de estoque após criar os atendimentos reverte agenda, serviços, auditoria e eventos", async () => {
    const f = await fixture();
    const product = await prisma.product.create({
      data: {
        salonId: f.salon.id,
        name: "Sem estoque",
        priceCents: 1000,
        stock: 0,
      },
    });
    await expect(
      withSalon(f.salon.id, (tx) =>
        createVisit(tx, {
          ...f.base,
          cartItems: [{ productId: product.id, quantity: 1 }],
          expectedProductTotalCents: 1000,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(
      await prisma.appointment.count({ where: { salonId: f.salon.id } }),
    ).toBe(0);
    expect(
      await prisma.appointmentEvent.count({ where: { salonId: f.salon.id } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { salonId: f.salon.id, action: "VISIT_CREATED" },
      }),
    ).toBe(0);
  });
  it("duas visitas concorrentes disputando a profissional confirmam só uma visita completa", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      withSalon(f.salon.id, (tx) => createVisit(tx, f.base)),
      withSalon(f.salon.id, (tx) =>
        createVisit(tx, { ...f.base, idempotencyKey: crypto.randomUUID() }),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.appointment.count({ where: { salonId: f.salon.id } }),
    ).toBe(2);
  });
  it("mudança de preço invalida a revisão sem gravar parte da visita", async () => {
    const f = await fixture();
    const quote = await withSalon(f.salon.id, async (tx) =>
      visitQuote(
        findVisitPlan(
          await loadVisitDay(tx, f.salon.id, f.date, f.choices),
          f.choices,
          900,
        )!,
      ),
    );
    await prisma.service.update({
      where: { id: f.services[1]!.id },
      data: { priceCents: 9999 },
    });
    await expect(
      withSalon(f.salon.id, (tx) => createVisit(tx, { ...f.base, quote })),
    ).rejects.toMatchObject({ code: "PRICE_CHANGED" });
    expect(
      await prisma.appointment.count({ where: { salonId: f.salon.id } }),
    ).toBe(0);
  });
  it("exceção manual permite folga e início após expediente, mas público não recebe a exceção", async () => {
    const f = await fixture();
    await prisma.professionalOpening.deleteMany({
      where: { salonId: f.salon.id },
    });
    await expect(
      withSalon(f.salon.id, (tx) => createVisit(tx, f.base)),
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    const result = await withSalon(f.salon.id, (tx) =>
      createVisit(tx, {
        ...f.base,
        manual: true,
        scheduleOverrideReason: "Solicitação na folga",
        startLocal: `${f.date}T21:00`,
        actor: { type: "STAFF", id: f.users[0]!.id, name: "Profissional" },
      }),
    );
    expect(result.appointmentIds).toHaveLength(2);
    expect(
      await prisma.auditLog.count({
        where: {
          salonId: f.salon.id,
          action: "APPOINTMENT_SCHEDULE_OVERRIDE_CREATE",
        },
      }),
    ).toBe(2);
  });
  it("edição em folga aplica serviços e horário imediatamente, aceite mantém o mesmo ID", async () => {
    const f = await fixture();
    const created = await withSalon(f.salon.id, (tx) =>
      createAppointment(tx, {
        ...f.base,
        professionalId: f.pros[0]!.id,
        serviceIds: [f.services[0]!.id],
        origin: "PUBLIC",
        enforceBookingWindow: true,
      }),
    );
    await prisma.professionalOpening.deleteMany({
      where: { salonId: f.salon.id },
    });
    const proposal = await withSalon(f.salon.id, (tx) =>
      requestStaffReschedule(tx, {
        salonId: f.salon.id,
        appointmentId: created.appointment.id,
        professionalId: f.pros[0]!.id,
        serviceIds: [f.services[0]!.id, f.services[0]!.id],
        startLocal: `${f.date}T21:00`,
        actor: { type: "STAFF", id: f.users[0]!.id, name: "Profissional" },
        idempotencyKey: crypto.randomUUID(),
        canOverrideSchedule: true,
        scheduleOverrideReason: "Atender fora da jornada",
        permittedProfessionalId: f.pros[0]!.id,
      }),
    );
    expect(proposal.requiresAcceptance).toBe(true);
    if (!proposal.requiresAcceptance) throw Error("Proposal expected");
    const prior = await prisma.appointment.findUniqueOrThrow({
      where: { id: created.appointment.id },
    });
    expect(prior.startAt.toISOString()).toContain("00:00:00");
    await withSalon(f.salon.id, (tx) =>
      respondToRescheduleProposal(tx, {
        salonId: f.salon.id,
        proposalId: proposal.proposalId,
        clientId: f.client.id,
        decision: "ACCEPT",
      }),
    );
    const after = await prisma.appointment.findUniqueOrThrow({
      where: { id: created.appointment.id },
      include: { serviceItems: true },
    });
    expect(after.serviceItems).toHaveLength(2);
    expect(after.startAt.toISOString()).toContain("00:00:00");
    expect(after.id).toBe(created.appointment.id);
  });
  it("remarcação protege destino, libera origem e retries/aceite não duplicam nem recalculam", async () => {
    const f = await fixture();
    const booking = { ...f.base, professionalId: f.pros[0]!.id, serviceIds: [f.services[0]!.id], origin: "ADMIN" as const, enforceBookingWindow: false };
    const original = await withSalon(f.salon.id, tx => createAppointment(tx, booking));
    const request = { salonId: f.salon.id, appointmentId: original.appointment.id, professionalId: f.pros[0]!.id, serviceIds: [f.services[0]!.id], startLocal: `${f.date}T18:30`, actor: { type: "STAFF" as const, id: f.users[0]!.id, name: "Profissional" }, idempotencyKey: crypto.randomUUID(), expectedVersion: 1 };
    const replies = await Promise.all([0, 1].map(() => withSalon(f.salon.id, tx => requestStaffReschedule(tx, request))));
    expect(replies.filter(r => r.duplicate)).toHaveLength(1);
    const proposal = replies[0]!;
    if (!proposal.requiresAcceptance) throw Error("Proposal expected");
    const before = await prisma.appointment.findUniqueOrThrow({ where: { id: original.appointment.id } });
    expect(before.version).toBe(2);
    await expect(withSalon(f.salon.id, tx => createAppointment(tx, { ...booking, startLocal: request.startLocal, idempotencyKey: crypto.randomUUID() }))).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    await withSalon(f.salon.id, tx => createAppointment(tx, { ...booking, idempotencyKey: crypto.randomUUID() }));
    await prisma.service.update({ where: { id: f.services[0]!.id }, data: { priceCents: 9000 } });
    await prisma.professionalOpening.deleteMany({ where: { salonId: f.salon.id } });
    const response = { salonId: f.salon.id, proposalId: proposal.proposalId, clientId: f.client.id, decision: "ACCEPT" as const };
    const accepted = await Promise.all([0, 1].map(() => withSalon(f.salon.id, tx => respondToRescheduleProposal(tx, response))));
    expect(accepted.filter(r => r.duplicate)).toHaveLength(1);
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: original.appointment.id } });
    expect(after).toEqual(before);
    expect(await prisma.appointmentEvent.count({ where: { appointmentId: original.appointment.id, idempotencyKey: `reschedule-proposal:${proposal.proposalId}:accepted` } })).toBe(1);
  });

  it("nova remarcação invalida resposta antiga; recusa mantém o destino sem ressuscitar a origem", async () => {
    const f = await fixture();
    const original = await withSalon(f.salon.id, tx => createAppointment(tx, { ...f.base, professionalId: f.pros[0]!.id, serviceIds: [f.services[0]!.id], origin: "ADMIN", enforceBookingWindow: false }));
    const request = { salonId: f.salon.id, appointmentId: original.appointment.id, professionalId: f.pros[0]!.id, serviceIds: [f.services[0]!.id], startLocal: `${f.date}T18:30`, actor: { type: "STAFF" as const, id: f.users[0]!.id, name: "Profissional" }, idempotencyKey: crypto.randomUUID(), expectedVersion: 1 };
    const first = await withSalon(f.salon.id, tx => requestStaffReschedule(tx, request));
    const second = await withSalon(f.salon.id, tx => requestStaffReschedule(tx, { ...request, startLocal: `${f.date}T19:00`, expectedVersion: 2, idempotencyKey: crypto.randomUUID() }));
    if (!first.requiresAcceptance || !second.requiresAcceptance) throw Error("Proposal expected");
    const response = { salonId: f.salon.id, proposalId: second.proposalId, clientId: f.client.id, decision: "REJECT" as const };
    await expect(withSalon(f.salon.id, tx => respondToRescheduleProposal(tx, { ...response, clientId: "another-client" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await withSalon(f.salon.id, tx => respondToRescheduleProposal(tx, { ...response, proposalId: first.proposalId, decision: "ACCEPT" }))).toMatchObject({ status: "CANCELLED", duplicate: true });
    const before = await prisma.appointment.findUniqueOrThrow({ where: { id: original.appointment.id } });
    expect(await withSalon(f.salon.id, tx => respondToRescheduleProposal(tx, response))).toMatchObject({ status: "REJECTED", duplicate: false });
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: original.appointment.id } })).toEqual(before);
    expect(await prisma.notificationOutbox.count({ where: { appointmentId: original.appointment.id, template: "appointment.reschedule_rejected", recipientId: f.users[0]!.id } })).toBe(1);
  });

  it("proposta anterior à mudança continua aplicando a reserva somente no aceite", async () => {
    const f = await fixture();
    const original = await withSalon(f.salon.id, tx => createAppointment(tx, { ...f.base, professionalId: f.pros[0]!.id, serviceIds: [f.services[0]!.id], origin: "ADMIN", enforceBookingWindow: false }));
    const targetStartAt = new Date(original.appointment.startAt.getTime() + 3600000);
    const legacy = await prisma.rescheduleProposal.create({ data: { salonId: f.salon.id, appointmentId: original.appointment.id, requestedById: f.users[0]!.id, targetProfessionalId: f.pros[0]!.id, sourceVersion: 1, targetStartAt, targetEndAt: new Date(targetStartAt.getTime() + 1800000), targetTimezone: f.salon.timezone, targetPriceCents: 5000, targetServices: [{ id: f.services[0]!.id, name: "Serviço original", durationMin: 30, priceCents: 5000 }], idempotencyKey: crypto.randomUUID(), requestFingerprint: "{}" } });
    const accepted = await withSalon(f.salon.id, tx => respondToRescheduleProposal(tx, { salonId: f.salon.id, proposalId: legacy.id, clientId: f.client.id, decision: "ACCEPT" }));
    expect(accepted.appointment).toMatchObject({ id: original.appointment.id, startAt: targetStartAt, version: 2 });
  });

});
