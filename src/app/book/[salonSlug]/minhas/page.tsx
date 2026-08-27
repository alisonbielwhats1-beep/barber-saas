import { redirect } from "next/navigation";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
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

function waitlistServiceName(value: unknown): string {
  if (!Array.isArray(value)) return "Serviço";
  const names = value.flatMap((item) => {
    const record = jsonRecord(item);
    return typeof record.serviceName === "string" ? [record.serviceName] : [];
  });
  return names.length > 0 ? names.join(" + ") : "Serviço";
}

function proposalServices(value: unknown): Array<{
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = jsonRecord(item);
    if (
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.durationMin !== "number" ||
      !Number.isInteger(record.durationMin) ||
      typeof record.priceCents !== "number" ||
      !Number.isInteger(record.priceCents)
    ) return [];
    return [{
      id: record.id,
      name: record.name,
      durationMin: record.durationMin,
      priceCents: record.priceCents,
    }];
  });
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
    const effectiveSession = await resolveClientSessionInTenant(tx, session, salonId);
    if (!effectiveSession) return null;
    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: {
        name: true,
        address: true,
        currency: true,
        timezone: true,
        cancelPolicyHours: true,
      },
    });
    if (!salon) return null;
    const appointments = await tx.appointment.findMany({
      where: { clientId: effectiveSession.clientId, salonId },
      orderBy: { startAt: "desc" },
      take: 60,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        priceCents: true,
        status: true,
        version: true,
        _count: {
          select: {
            waitlistEntries: {
              where: { fulfilledAt: null, cancelledAt: null },
            },
          },
        },
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
        reviews: {
          where: { clientId: effectiveSession.clientId },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, rating: true, comment: true, status: true, createdAt: true },
        },
      },
    });
    const waitlistEntries = await tx.waitlistEntry.findMany({
      where: {
        salonId,
        clientId: effectiveSession.clientId,
        fulfilledAt: null,
        cancelledAt: null,
        startAt: { gt: new Date() },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 30,
      select: {
        id: true,
        appointmentId: true,
        startAt: true,
        timezone: true,
        serviceSnapshots: true,
        professional: { select: { user: { select: { name: true } } } },
      },
    });
    const pendingProposals = await tx.rescheduleProposal.findMany({
      where: {
        salonId,
        status: "PENDING",
        appointment: { clientId: effectiveSession.clientId },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        appointmentId: true,
        targetStartAt: true,
        targetEndAt: true,
        targetTimezone: true,
        targetPriceCents: true,
        targetServices: true,
        reason: true,
        targetProfessional: { select: { user: { select: { name: true } } } },
        appointment: {
          select: {
            startAt: true,
            endAt: true,
            timezone: true,
            professional: { select: { user: { select: { name: true } } } },
          },
        },
      },
    });
    const queueOrder = waitlistEntries.length === 0
      ? []
      : await tx.waitlistEntry.findMany({
          where: {
            salonId,
            appointmentId: { in: waitlistEntries.map((entry) => entry.appointmentId) },
            fulfilledAt: null,
            cancelledAt: null,
          },
          select: { id: true, appointmentId: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
    const positions = new Map<string, number>();
    const counters = new Map<string, number>();
    for (const entry of queueOrder) {
      const position = (counters.get(entry.appointmentId) ?? 0) + 1;
      counters.set(entry.appointmentId, position);
      positions.set(entry.id, position);
    }
    return {
      salon,
      session: effectiveSession,
      appointments,
      pendingProposals,
      waitlistEntries: waitlistEntries.map((entry) => ({
        ...entry,
        position: positions.get(entry.id) ?? 1,
      })),
    };
  });
  if (!result) redirect(`/book/${salonSlug}/login`);
  const { salon, session: effectiveSession, appointments, pendingProposals, waitlistEntries } = result;

  // Serialize Date objects — can't pass them directly to client components
  const serialized = appointments.map((a) => ({
    ...a,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    status: a.status as string,
    review: a.reviews[0]
      ? {
          id: a.reviews[0].id,
          rating: a.reviews[0].rating,
          comment: a.reviews[0].comment,
          status: a.reviews[0].status as string,
          createdAt: a.reviews[0].createdAt.toISOString(),
        }
      : null,
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
  const serializedProposals = pendingProposals.map((proposal) => ({
    id: proposal.id,
    appointmentId: proposal.appointmentId,
    currentStartAt: proposal.appointment.startAt.toISOString(),
    currentEndAt: proposal.appointment.endAt.toISOString(),
    currentTimezone: proposal.appointment.timezone,
    currentProfessionalName: proposal.appointment.professional.user.name,
    targetStartAt: proposal.targetStartAt.toISOString(),
    targetEndAt: proposal.targetEndAt.toISOString(),
    targetTimezone: proposal.targetTimezone,
    targetPriceCents: proposal.targetPriceCents,
    targetProfessionalName: proposal.targetProfessional.user.name,
    targetServices: proposalServices(proposal.targetServices),
    reason: proposal.reason,
  }));

  return (
    <main className="animate-fade-in space-y-6 px-5 pb-28 pt-6">
      <AutoRefresh />
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Olá, {effectiveSession.name.split(" ")[0]}
        </p>
        <h1 className="text-2xl font-semibold">Minhas reservas</h1>
        <p className="mt-1 text-sm text-muted-foreground">{salon.name}</p>
      </header>

      <MinhasList
        appointments={serialized}
        pendingProposals={serializedProposals}
        waitlistEntries={waitlistEntries.map((entry) => ({
          id: entry.id,
          position: entry.position,
          startAt: entry.startAt.toISOString(),
          timezone: entry.timezone,
          serviceName: waitlistServiceName(entry.serviceSnapshots),
          professionalName: entry.professional.user.name,
        }))}
        salonSlug={salonSlug}
        currency={salon.currency}
        timezone={salon.timezone}
        cancelPolicyHours={salon.cancelPolicyHours}
        salonName={salon.name}
        salonAddress={salon.address}
        session={effectiveSession}
      />

    </main>
  );
}
