import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { AgendaBoard, type Appointment, type Professional } from "./agenda-board";
import type { ServiceOption, ClientOption } from "./appointment-form";
import { dateKeyInTimeZone, isDateKey, monthRangeInTimeZone } from "@/lib/time";
import { AutoRefresh } from "@/components/auto-refresh";

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await getTenantContext();
  const { salonId, role } = ctx;
  const { date: selectedDate } = await searchParams;

  // Sequencial de propósito: pooler com connection_limit=1 em serverless —
  // 5 queries em Promise.all estouravam o timeout do pool (P2024). Dentro de
  // withTenant, as 5 passam a usar uma única conexão em vez de 5 aquisições.
  const { salon, dateStr, prosRaw, apptsRaw, waitlistRaw, services, clients } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: { name: true, timezone: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");
    const dateStr = selectedDate && isDateKey(selectedDate)
      ? selectedDate
      : dateKeyInTimeZone(new Date(), salon.timezone);
    const range = monthRangeInTimeZone(dateStr, salon.timezone);
    const ownProfessional = role === "PROFESSIONAL"
      ? await tx.professional.findFirst({
          where: { salonId, userId: ctx.userId, active: true },
          select: { id: true },
        })
      : null;
    const professionalId = role === "PROFESSIONAL"
      ? (ownProfessional?.id ?? "__professional_not_found__")
      : undefined;
    const prosRaw = await tx.professional.findMany({
      where: {
        salonId,
        active: true,
        ...(professionalId ? { id: professionalId } : {}),
      },
      select: {
        id: true,
        colorHex: true,
        user: { select: { name: true, avatarUrl: true } },
        services: { select: { serviceId: true } },
      },
      orderBy: { user: { name: "asc" } },
    });
    const apptsRaw = await tx.appointment.findMany({
      where: {
        salonId,
        ...(professionalId ? { professionalId } : {}),
        startAt: { gte: range.from, lt: range.to },
      },
      select: {
        id: true,
        professionalId: true,
        startAt: true,
        endAt: true,
        priceCents: true,
        status: true,
        notes: true,
        isOverbooked: true,
        version: true,
        payment: { select: { id: true } },
        client: { select: { name: true, phone: true } },
        service: { select: { id: true, name: true, colorHex: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: { serviceId: true, serviceName: true },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 12,
          select: {
            id: true,
            eventType: true,
            actorType: true,
            reason: true,
            createdAt: true,
            previousValue: true,
            newValue: true,
          },
        },
      },
      orderBy: { startAt: "asc" },
    });
    const waitlistRaw = await tx.waitlistEntry.findMany({
      where: {
        salonId,
        appointmentId: { in: apptsRaw.map((a) => a.id) },
        fulfilledAt: null,
      },
      select: {
        appointmentId: true,
        guestName: true,
        client: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const services = await tx.service.findMany({
      where: { salonId, active: true },
      select: { id: true, name: true, durationMin: true, priceCents: true },
      orderBy: { name: "asc" },
    });
    const clients = role === "PROFESSIONAL"
      ? []
      : await tx.clientProfile.findMany({
          where: { salonId },
          select: { id: true, name: true, phone: true },
          orderBy: { name: "asc" },
          take: 300,
        });
    return { salon, dateStr, prosRaw, apptsRaw, waitlistRaw, services, clients };
  });

  // Fila de espera por agendamento (só quem ainda não foi atendido) — pro
  // dono ver, antes de cancelar, se tem gente esperando aquela vaga.
  const waitlistByAppt = new Map<string, string[]>();
  for (const w of waitlistRaw) {
    const name = w.client?.name ?? w.guestName ?? "Cliente";
    const list = waitlistByAppt.get(w.appointmentId) ?? [];
    list.push(name);
    waitlistByAppt.set(w.appointmentId, list);
  }

  const professionals: Professional[] = prosRaw.map((p) => ({
    id: p.id,
    name: p.user.name,
    colorHex: p.colorHex,
    serviceIds: p.services.map((s) => s.serviceId),
  }));

  const appointments: Appointment[] = apptsRaw.map((a) => {
    const waiting = waitlistByAppt.get(a.id) ?? [];
    const events = a.events.map((event) => {
      const previousValue = jsonRecord(event.previousValue);
      const newValue = jsonRecord(event.newValue);
      const actor = jsonRecord(newValue.actor);
      return {
        id: event.id,
        eventType: event.eventType,
        actorType: event.actorType,
        actorName: optionalString(actor.name),
        reason: event.reason,
        createdAt: event.createdAt.toISOString(),
        previousStartAt: optionalString(previousValue.startAt),
        startAt: optionalString(newValue.startAt),
        previousStatus: optionalString(previousValue.status),
        status: optionalString(newValue.status),
      };
    });
    return {
      id: a.id,
      professionalId: a.professionalId,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      priceCents: a.priceCents,
      status: a.status,
      notes: a.notes,
      clientName: a.client.name,
      clientPhone: a.client.phone,
      serviceIds: a.serviceItems.length > 0
        ? a.serviceItems.map((item) => item.serviceId)
        : [a.service.id],
      serviceName: a.serviceItems.length > 0
        ? a.serviceItems.map((item) => item.serviceName).join(" + ")
        : a.service.name,
      serviceColor: a.service.colorHex,
      waitlistCount: waiting.length,
      waitlistNext: waiting[0] ?? null,
      isOverbooked: a.isOverbooked,
      version: a.version,
      hasPayment: Boolean(a.payment),
      events,
    };
  });

  return (
    <>
      <AutoRefresh />
      <AgendaBoard
        date={dateStr}
        salonName={salon?.name ?? "seu salão"}
        timezone={salon.timezone}
        professionals={professionals}
        appointments={appointments}
        services={services as ServiceOption[]}
        clients={clients as ClientOption[]}
        canOverbook={role === "OWNER" || role === "MANAGER"}
        canCreate={role !== "PROFESSIONAL"}
        canCancel={role === "OWNER" || role === "MANAGER"}
      />
    </>
  );
}
