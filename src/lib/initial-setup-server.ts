import type { Tx } from "./prisma-tenant";
import type { TenantContext } from "./tenant";
import {
  HOURS_ACTION,
  REVIEW_ACTION,
  SETUP_ACTION,
  setupHoursSchema,
  type SetupData,
} from "./initial-setup";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getInitialSetup(
  tx: Tx,
  ctx: TenantContext,
): Promise<SetupData> {
  const where = {
    salonId: ctx.salonId,
    entityType: "Salon",
    entityId: ctx.salonId,
  };
  const [
    salon,
    user,
    services,
    professionals,
    progress,
    hoursEvent,
    reviews,
    appointment,
  ] = await Promise.all([
    tx.salon.findUniqueOrThrow({
      where: { id: ctx.salonId },
      select: {
        name: true,
        slug: true,
        address: true,
        phone: true,
        timezone: true,
        openMinutes: true,
        closeMinutes: true,
      },
    }),
    tx.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { name: true },
    }),
    tx.service.findMany({
      where: { salonId: ctx.salonId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, durationMin: true, priceCents: true },
    }),
    tx.professional.findMany({
      where: { salonId: ctx.salonId, active: true },
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        user: { select: { name: true } },
        services: { select: { serviceId: true } },
        workingHours: {
          select: { weekday: true, startMinutes: true, endMinutes: true },
        },
      },
    }),
    tx.auditLog.findFirst({
      where: { ...where, action: SETUP_ACTION },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true },
    }),
    tx.auditLog.findFirst({
      where: { ...where, action: HOURS_ACTION },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true },
    }),
    tx.auditLog.findMany({
      where: {
        salonId: ctx.salonId,
        action: REVIEW_ACTION,
        entityType: "Service",
      },
      distinct: ["entityId"],
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { entityId: true, metadata: true },
    }),
    tx.appointment.findFirst({
      where: { salonId: ctx.salonId },
      select: { id: true },
    }),
  ]);
  const meta = record(progress?.metadata);
  const parsedHours = setupHoursSchema.safeParse(
    record(hoursEvent?.metadata).hours,
  );
  const existingHours =
    professionals.find((p) => p.workingHours.length)?.workingHours ?? [];
  return {
    salon,
    userId: ctx.userId,
    userName: user.name,
    services: services.map((s) => ({
      ...s,
      reviewed:
        s.priceCents > 0 ||
        reviews.some(
          (r) =>
            r.entityId === s.id &&
            record(r.metadata).priceCents === s.priceCents &&
            record(r.metadata).durationMin === s.durationMin &&
            record(r.metadata).name === s.name,
        ),
    })),
    professionals: professionals.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user.name,
      serviceIds: p.services.map((s) => s.serviceId),
      hours: p.workingHours,
    })),
    hours: parsedHours.success ? parsedHours.data : existingHours,
    hoursConfirmed: parsedHours.success || existingHours.length > 0,
    status:
      meta.status === "active" ||
      meta.status === "deferred" ||
      meta.status === "completed"
        ? meta.status
        : "new",
    step:
      typeof meta.step === "number" &&
      Number.isInteger(meta.step) &&
      meta.step >= 0 &&
      meta.step <= 3
        ? meta.step
        : 0,
    hasAppointments: Boolean(appointment),
  };
}
