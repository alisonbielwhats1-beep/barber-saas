import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { AgendaBoard, type Appointment, type Professional } from "./agenda-board";
import type { ServiceOption, ClientOption } from "./appointment-form";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await getTenantContext();
  const { salonId, role } = ctx;
  const { date: selectedDate } = await searchParams;
  const date = selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date();
  const dateStr = format(date, "yyyy-MM-dd");

  // Sequencial de propósito: pooler com connection_limit=1 em serverless —
  // 5 queries em Promise.all estouravam o timeout do pool (P2024). Dentro de
  // withTenant, as 5 passam a usar uma única conexão em vez de 5 aquisições.
  const { salon, prosRaw, apptsRaw, waitlistRaw, services, clients } = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { name: true } });
    const prosRaw = await tx.professional.findMany({
      where: { salonId, active: true },
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
        startAt: { gte: startOfMonth(date), lte: endOfMonth(date) },
        status: { not: "CANCELLED" },
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
        client: { select: { name: true, phone: true } },
        service: { select: { name: true, colorHex: true } },
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
    const clients = await tx.clientProfile.findMany({
      where: { salonId },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
      take: 300,
    });
    return { salon, prosRaw, apptsRaw, waitlistRaw, services, clients };
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
      serviceName: a.service.name,
      serviceColor: a.service.colorHex,
      waitlistCount: waiting.length,
      waitlistNext: waiting[0] ?? null,
      isOverbooked: a.isOverbooked,
    };
  });

  return (
    <AgendaBoard
      date={dateStr}
      salonName={salon?.name ?? "seu salão"}
      professionals={professionals}
      appointments={appointments}
      services={services as ServiceOption[]}
      clients={clients as ClientOption[]}
      canOverbook={role === "OWNER" || role === "MANAGER"}
    />
  );
}
