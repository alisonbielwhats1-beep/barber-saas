import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/client-auth";
import { clientSessionForSalon } from "@/lib/public-appointment";
import { BookingFlow } from "./booking-flow";

export default async function AgendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonSlug: string }>;
  searchParams: Promise<{ service?: string; pro?: string }>;
}) {
  const [{ salonSlug }, query] = await Promise.all([params, searchParams]);
  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: {
      id: true,
      name: true,
      currency: true,
      timezone: true,
      services: {
        where: { active: true },
        include: {
          professionals: {
            include: {
              professional: {
                select: {
                  id: true,
                  colorHex: true,
                  active: true,
                  user: { select: { name: true, avatarUrl: true } },
                  // serviços que o profissional executa → vira tag de especialidade
                  services: {
                    select: { service: { select: { name: true } } },
                    take: 3,
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!salon) notFound();

  const clientSession = await getClientSession();
  const validSession = clientSessionForSalon(clientSession, salon.id);

  // Contagem real de atendimentos por profissional (prova social honesta)
  const counts = await prisma.appointment.groupBy({
    by: ["professionalId"],
    where: {
      salonId: salon.id,
      status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
    },
    _count: { _all: true },
  });
  const countByPro = new Map(counts.map((c) => [c.professionalId, c._count._all]));
  const topProId =
    counts.length > 1
      ? counts.reduce((a, b) => (b._count._all > a._count._all ? b : a)).professionalId
      : null;

  const services = salon.services.map((s) => ({
    id: s.id,
    name: s.name,
    priceCents: s.priceCents,
    durationMin: s.durationMin,
    colorHex: s.colorHex,
    professionals: s.professionals
      .filter((ps) => ps.professional.active)
      .map((ps) => ({
        id: ps.professional.id,
        name: ps.professional.user.name,
        avatarUrl: ps.professional.user.avatarUrl,
        colorHex: ps.professional.colorHex,
        specialties: ps.professional.services.map((x) => x.service.name),
        apptCount: countByPro.get(ps.professional.id) ?? 0,
        topPro: ps.professional.id === topProId,
      })),
  }));

  return (
    <BookingFlow
      salonId={salon.id}
      salonName={salon.name}
      salonTimeZone={salon.timezone}
      currency={salon.currency}
      services={services}
      initialServiceId={query.service ?? null}
      initialProId={query.pro ?? null}
      clientSession={validSession}
    />
  );
}
