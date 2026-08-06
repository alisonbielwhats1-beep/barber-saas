import { redirect } from "next/navigation";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import { MinhasList } from "./minhas-list";
import { AutoRefresh } from "@/components/auto-refresh";

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export default async function MinhasPage({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const session = await getClientSession();
  if (!session) redirect(`/book/${salonSlug}/login`);

  // withSalonBySlug resolve o salão pelo slug e já abre a transação com a
  // GUC certa; a comparação com session.salonId impede um cliente logado no
  // salão A de ver dados do salão B só trocando o slug na URL — se não bater,
  // o callback devolve null e cai no mesmo redirect de "salão não encontrado".
  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    if (session.salonId !== salonId) return null;
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: {
        name: true,
        currency: true,
        timezone: true,
        cancelPolicyHours: true,
      },
    });
    if (!salon) return null;
    const appointments = await tx.appointment.findMany({
      where: { clientId: session.clientId, salonId },
      orderBy: { startAt: "desc" },
      take: 60,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        priceCents: true,
        status: true,
        version: true,
        service: { select: { id: true, name: true, colorHex: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: { serviceId: true, serviceName: true },
        },
        professional: { select: { id: true, user: { select: { name: true } } } },
        events: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            eventType: true,
            actorType: true,
            reason: true,
            createdAt: true,
            previousValue: true,
            newValue: true,
          },
        },
        products: {
          select: {
            quantity: true,
            priceCentsUnit: true,
            product: { select: { name: true } },
          },
        },
      },
    });
    return { salon, appointments };
  });
  if (!result) redirect(`/book/${salonSlug}/login`);
  const { salon, appointments } = result;

  // Serialize Date objects — can't pass them directly to client components
  const serialized = appointments.map((a) => ({
    ...a,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    status: a.status as string,
    events: a.events.map((event) => {
      const previousValue = jsonRecord(event.previousValue);
      const newValue = jsonRecord(event.newValue);
      const actor = jsonRecord(newValue.actor);
      return {
        id: event.id,
        eventType: event.eventType as string,
        actorType: event.actorType as string,
        actorName: optionalString(actor.name),
        reason: event.reason,
        createdAt: event.createdAt.toISOString(),
        previousStartAt: optionalString(previousValue.startAt),
        startAt: optionalString(newValue.startAt),
      };
    }),
  }));

  return (
    <main className="animate-fade-in space-y-6 px-5 pb-28 pt-6">
      <AutoRefresh />
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Olá, {session.name.split(" ")[0]}
        </p>
        <h1 className="text-2xl font-semibold">Minhas visitas</h1>
      </header>

      <MinhasList
        appointments={serialized}
        salonSlug={salonSlug}
        currency={salon.currency}
        timezone={salon.timezone}
        cancelPolicyHours={salon.cancelPolicyHours}
        session={session}
      />

    </main>
  );
}
