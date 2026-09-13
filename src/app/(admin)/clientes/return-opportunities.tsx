import Link from "next/link";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  startOfDateInTimeZone,
} from "@/lib/time";
import { getBookingPreferences } from "@/lib/booking-preferences";
import { predictedReturn } from "@/lib/client-return";
import { hiddenClientIds } from "@/lib/client-list-visibility";
import { isValidPhoneBR, normalizePhone } from "@/lib/phone";

export async function ReturnOpportunities() {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER"]);
  const data = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUniqueOrThrow({
      where: { id: ctx.salonId },
      select: { timezone: true, slug: true, name: true },
    });
    const today = dateKeyInTimeZone(new Date(), salon.timezone);
    const preferences = await getBookingPreferences(tx, ctx.salonId);
    const hidden = await hiddenClientIds(tx, ctx.salonId);
    const visits = await tx.appointment.findMany({
      where: {
        salonId: ctx.salonId,
        status: "COMPLETED",
        startAt: {
          gte: startOfDateInTimeZone(
            addCalendarDays(today, -365),
            salon.timezone,
          ),
        },
        dependentId: null,
        dependentName: null,
        clientId: { notIn: [...hidden] },
      },
      select: {
        id: true,
        clientId: true,
        startAt: true,
        serviceId: true,
        service: { select: { name: true } },
        serviceItems: { select: { serviceId: true, serviceName: true } },
        client: { select: { name: true, phone: true } },
      },
      orderBy: { startAt: "desc" },
    });
    const upcoming = await tx.appointment.findMany({
      where: {
        salonId: ctx.salonId,
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
        startAt: { gte: startOfDateInTimeZone(today, salon.timezone) },
        dependentId: null,
        dependentName: null,
      },
      select: { clientId: true },
    });
    const booked = new Set(upcoming.map((a) => a.clientId));
    const groups = new Map<
      string,
      {
        clientId: string;
        name: string;
        phone: string | null;
        service: string;
        serviceId: string;
        dates: string[];
      }
    >();
    for (const visit of visits) {
      if (booked.has(visit.clientId)) continue;
      for (const item of visit.serviceItems.length
        ? visit.serviceItems
        : [{ serviceId: visit.serviceId, serviceName: visit.service.name }]) {
        const key = `${visit.clientId}:${item.serviceId}`;
        const group = groups.get(key) ?? {
          clientId: visit.clientId,
          name: visit.client.name,
          phone: visit.client.phone,
          service: item.serviceName,
          serviceId: item.serviceId,
          dates: [],
        };
        group.dates.push(dateKeyInTimeZone(visit.startAt, salon.timezone));
        groups.set(key, group);
      }
    }
    const rows = [...groups.values()]
      .flatMap((group) => {
        const estimate = predictedReturn(
          group.dates,
          preferences.serviceReturnDays[group.serviceId] ??
            preferences.returnDays,
        );
        return estimate && estimate.date <= addCalendarDays(today, 7)
          ? [{ ...group, estimate }]
          : [];
      })
      .sort((a, b) => a.estimate.date.localeCompare(b.estimate.date));
    return { rows, salon, today };
  });
  return (
    <details className="rounded-xl border border-border bg-card p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">
        Retornos previstos · {data.rows.length} oportunidade(s)
      </summary>
      <p className="mb-3 text-sm text-muted-foreground">
        Clientes sem próxima reserva. Previsões por histórico ou intervalo
        configurado; confira antes de entrar em contato.
      </p>
      <div className="max-h-80 divide-y divide-border overflow-y-auto">
        {data.rows.length === 0 && (
          <p className="py-3 text-sm">
            Nenhum retorno pendente ou previsto para os próximos sete dias.
          </p>
        )}
        {data.rows.map((row) => (
          <div
            key={`${row.clientId}:${row.serviceId}`}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="font-medium">
                {row.name} · {row.service}
              </p>
              <p className="text-xs text-muted-foreground">
                Retorno {row.estimate.date.split("-").reverse().join("/")} ·{" "}
                {row.estimate.cadence} dias (
                {row.estimate.fromHistory
                  ? "histórico de visitas"
                  : "intervalo configurado"}
                )
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href="/agenda"
                className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm"
              >
                Agendar retorno
              </Link>
              {row.phone && isValidPhoneBR(row.phone) && (
                <a
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm"
                  href={`https://wa.me/${normalizePhone(row.phone)}?text=${encodeURIComponent(`Olá, ${row.name}! Quer agendar seu próximo ${row.service} no ${data.salon.name}?`)}`}
                >
                  Preparar WhatsApp
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
