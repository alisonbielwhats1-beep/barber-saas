import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { AgendaBoard, type Appointment, type Professional } from "./agenda-board";
import type { ServiceOption, ClientOption } from "./appointment-form";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const { salonId } = await getTenantContext();
  const date = searchParams.date ? new Date(`${searchParams.date}T12:00:00`) : new Date();
  const dateStr = format(date, "yyyy-MM-dd");

  const [salon, prosRaw, apptsRaw, services, clients] = await Promise.all([
    prisma.salon.findUnique({ where: { id: salonId }, select: { name: true } }),
    prisma.professional.findMany({
      where: { salonId, active: true },
      select: {
        id: true,
        colorHex: true,
        user: { select: { name: true, avatarUrl: true } },
        services: { select: { serviceId: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.appointment.findMany({
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
        client: { select: { name: true, phone: true } },
        service: { select: { name: true, colorHex: true } },
      },
      orderBy: { startAt: "asc" },
    }),
    prisma.service.findMany({
      where: { salonId, active: true },
      select: { id: true, name: true, durationMin: true, priceCents: true },
      orderBy: { name: "asc" },
    }),
    prisma.clientProfile.findMany({
      where: { salonId },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
  ]);

  const professionals: Professional[] = prosRaw.map((p) => ({
    id: p.id,
    name: p.user.name,
    colorHex: p.colorHex,
    serviceIds: p.services.map((s) => s.serviceId),
  }));

  const appointments: Appointment[] = apptsRaw.map((a) => ({
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
  }));

  return (
    <AgendaBoard
      date={dateStr}
      salonName={salon?.name ?? "seu salão"}
      professionals={professionals}
      appointments={appointments}
      services={services as ServiceOption[]}
      clients={clients as ClientOption[]}
    />
  );
}
