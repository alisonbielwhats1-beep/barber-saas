import Link from "next/link";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";

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
          select: { active: true, user: { select: { name: true } } },
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
  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <h2 className="font-semibold">Meu atendimento de sempre</h2>
      <p className="mt-2 text-sm">
        {items.map((s) => s.serviceName).join(" + ")} ·{" "}
        {data.professional.user.name}
      </p>
      {data.dependentName && (
        <p className="mt-1 text-sm">
          Sua última reserva foi para {data.dependentName}. Confira quem será
          atendido nesta nova reserva.
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {active
          ? "Repita a seleção do último atendimento e confira os valores atuais."
          : "Há opções indisponíveis no último atendimento. Revise os serviços e o profissional."}
      </p>
      <Link
        className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        href={`/book/${salonSlug}/agendar?${params}`}
      >
        {active ? "Escolher dia e horário" : "Revisar e agendar"}
      </Link>
    </section>
  );
}
