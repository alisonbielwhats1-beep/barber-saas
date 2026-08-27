import { notFound } from "next/navigation";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { BookingFlow } from "./booking-flow";
import { dateKeyInTimeZone } from "@/lib/time";
import { normalizeImageUrl } from "@/lib/images";

export default async function AgendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonSlug: string }>;
  searchParams: Promise<{
    service?: string;
    services?: string;
    pro?: string;
    reschedule?: string;
    version?: string;
  }>;
}) {
  const [{ salonSlug }, query] = await Promise.all([params, searchParams]);
  const initialServiceIds = [
    ...new Set(
      (query.services ?? query.service ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 10),
    ),
  ];
  const clientSession = await getClientSession();
  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        address: true,
        currency: true,
        timezone: true,
        cancelPolicyHours: true,
        maxBookingLeadDays: true,
        services: {
          where: { active: true },
          orderBy: [{ category: "asc" }, { name: "asc" }],
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
    if (!salon) return null;

    // Contagem real de atendimentos por profissional (prova social honesta)
    const counts = await tx.appointment.groupBy({
      by: ["professionalId"],
      where: {
        salonId,
        status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
      },
      _count: { _all: true },
    });
    const validSession = await resolveClientSessionInTenant(tx, clientSession, salonId);
    return { salon, counts, validSession };
  });
  if (!result) notFound();
  const { salon, counts, validSession } = result;

  const countByPro = new Map(counts.map((c) => [c.professionalId, c._count._all]));
  const topProId =
    counts.length > 1
      ? counts.reduce((a, b) => (b._count._all > a._count._all ? b : a)).professionalId
      : null;

  const services = salon.services.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    priceCents: s.priceCents,
    durationMin: s.durationMin,
    colorHex: s.colorHex,
    category: s.category,
    imageUrl: normalizeImageUrl(s.imageUrl),
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
      salonAddress={salon.address}
      currency={salon.currency}
      timezone={salon.timezone}
      cancelPolicyHours={salon.cancelPolicyHours}
      maxBookingLeadDays={salon.maxBookingLeadDays}
      todayDate={dateKeyInTimeZone(new Date(), salon.timezone)}
      services={services}
      initialServiceIds={initialServiceIds}
      initialProId={query.pro ?? null}
      rescheduleId={query.reschedule ?? null}
      rescheduleVersion={query.version ? Number(query.version) : undefined}
      clientSession={validSession}
    />
  );
}
