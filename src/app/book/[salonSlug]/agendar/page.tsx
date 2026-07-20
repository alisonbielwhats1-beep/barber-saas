import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BookingFlow } from "./booking-flow";

export default async function AgendarPage({
  params,
  searchParams,
}: {
  params: { salonSlug: string };
  searchParams: { service?: string };
}) {
  const salon = await prisma.salon.findUnique({
    where: { slug: params.salonSlug },
    select: {
      id: true,
      name: true,
      currency: true,
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
                },
              },
            },
          },
        },
      },
    },
  });
  if (!salon) notFound();

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
        colorHex: ps.professional.colorHex,
      })),
  }));

  return (
    <BookingFlow
      salonId={salon.id}
      salonName={salon.name}
      currency={salon.currency}
      services={services}
      initialServiceId={searchParams.service ?? null}
    />
  );
}
