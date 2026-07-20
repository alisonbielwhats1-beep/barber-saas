import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { startOfDay, endOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AgendaGrid, type Appointment, type Professional } from "./agenda-grid";
import type { ServiceOption, ClientOption } from "./appointment-form";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const { salonId } = await getTenantContext();
  const date = searchParams.date ? new Date(searchParams.date) : new Date();
  const dateStr = format(date, "yyyy-MM-dd");

  const [prosRaw, apptsRaw, services, clients] = await Promise.all([
    prisma.professional.findMany({
      where: { salonId, active: true },
      select: {
        id: true,
        colorHex: true,
        user: { select: { name: true } },
        services: { select: { serviceId: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.appointment.findMany({
      where: {
        salonId,
        startAt: { gte: startOfDay(date), lte: endOfDay(date) },
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        professionalId: true,
        startAt: true,
        endAt: true,
        priceCents: true,
        status: true,
        client: { select: { name: true } },
        service: { select: { name: true, colorHex: true } },
      },
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
      take: 200,
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
    clientName: a.client.name,
    serviceName: a.service.name,
    serviceColor: a.service.colorHex,
  }));

  const serviceOptions: ServiceOption[] = services;
  const clientOptions: ClientOption[] = clients;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {format(date, "EEEE", { locale: ptBR })}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {format(date, "dd 'de' MMMM", { locale: ptBR })}
          </h1>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-[12px] text-muted-foreground">
          {appointments.length} agendamento{appointments.length !== 1 ? "s" : ""}
        </span>
      </header>

      <AgendaGrid
        date={dateStr}
        professionals={professionals}
        appointments={appointments}
        services={serviceOptions}
        clients={clientOptions}
      />
    </div>
  );
}
