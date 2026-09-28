import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { getClientSession } from "@/lib/client-auth";
import { normalizeImageUrl } from "@/lib/images";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";

export async function UsualBooking({ salonSlug }: { salonSlug: string }) {
  const session = await getClientSession();
  if (!session) return null;
  const data = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const client = await resolveClientSessionInTenant(tx, session, salonId);
    if (!client) return null;
    return tx.appointment.findFirst({
      where: { salonId, clientId: client.clientId, status: "COMPLETED" },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      select: {
        dependentName: true,
        professionalId: true,
        professional: {
          select: { active: true, user: { select: { name: true, avatarUrl: true } } },
        },
        serviceId: true,
        service: { select: { name: true, active: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: {
            serviceId: true,
            serviceName: true,
            service: { select: { active: true } },
          },
        },
      },
    });
  });
  if (!data) return null;
  const items = data.serviceItems.length
    ? data.serviceItems
    : [
        {
          serviceId: data.serviceId,
          serviceName: data.service.name,
          service: data.service,
        },
      ];
  const active =
    items.every((s) => s.service.active) && data.professional.active;
  const params = new URLSearchParams({
    services: items
      .filter((s) => s.service.active)
      .map((s) => s.serviceId)
      .join(","),
    ...(data.professional.active ? { pro: data.professionalId } : {}),
  });
  const serviceNames = items.map((s) => s.serviceName).join(" + ");
  const professionalName = data.professional.user.name;
  const avatar = normalizeImageUrl(data.professional.user.avatarUrl);
  const initials = (
    <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
      {(professionalName || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
  return (
    <section aria-labelledby="usual-booking-title" className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        {avatar ? (
          <ImageWithFallback
            src={avatar}
            alt=""
            width={88}
            height={88}
            sizes="44px"
            className="h-11 w-11 shrink-0 rounded-full object-cover"
            fallback={initials}
          />
        ) : initials}
        <div className="min-w-0 flex-1">
          <h2 id="usual-booking-title" className="text-[11px] font-medium text-muted-foreground">
            Seu último atendimento
          </h2>
          <p className="truncate text-sm font-semibold">{serviceNames}</p>
          <p className="truncate text-xs text-muted-foreground">com {professionalName}</p>
        </div>
        <Link
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          href={`/book/${salonSlug}/agendar?${params}`}
          aria-label={`${active ? "Repetir" : "Revisar e agendar"}: ${serviceNames} com ${professionalName}`}
        >
          {active && <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />}
          {active ? "Repetir" : "Revisar"}
        </Link>
      </div>
      {data.dependentName && (
        <p className="mt-2 text-xs text-muted-foreground">
          Sua última reserva foi para {data.dependentName}. Confira quem será
          atendido nesta nova reserva.
        </p>
      )}
      {!active && (
        <p className="mt-2 text-xs text-muted-foreground">
          Há opções indisponíveis no último atendimento. Revise os serviços e o profissional.
        </p>
      )}
    </section>
  );
}
