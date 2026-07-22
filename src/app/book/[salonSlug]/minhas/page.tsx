import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/client-auth";
import { BottomNav } from "../bottom-nav";
import { MinhasList } from "./minhas-list";

export default async function MinhasPage({
  params,
}: {
  params: { salonSlug: string };
}) {
  const session = await getClientSession();
  if (!session) redirect(`/book/${params.salonSlug}/login`);

  // Verify session belongs to this salon
  const salon = await prisma.salon.findUnique({
    where: { slug: params.salonSlug },
    select: { id: true, name: true, currency: true },
  });
  if (!salon || session.salonId !== salon.id) {
    redirect(`/book/${params.salonSlug}/login`);
  }

  const appointments = await prisma.appointment.findMany({
    where: { clientId: session.clientId },
    orderBy: { startAt: "desc" },
    take: 60,
    select: {
      id: true,
      startAt: true,
      endAt: true,
      priceCents: true,
      status: true,
      service: { select: { name: true, colorHex: true } },
      professional: { select: { user: { select: { name: true } } } },
      products: {
        select: {
          quantity: true,
          priceCentsUnit: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  // Serialize Date objects — can't pass them directly to client components
  const serialized = appointments.map((a) => ({
    ...a,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    status: a.status as string,
  }));

  return (
    <main className="animate-fade-in space-y-6 px-5 pb-28 pt-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Olá, {session.name.split(" ")[0]}
        </p>
        <h1 className="text-2xl font-semibold">Minhas visitas</h1>
      </header>

      <MinhasList
        appointments={serialized}
        salonSlug={params.salonSlug}
        currency={salon.currency}
        session={session}
      />

      <BottomNav salonSlug={params.salonSlug} />
    </main>
  );
}
