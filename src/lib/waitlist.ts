import type { Tx } from "./prisma-tenant";
import { isOverlapViolation } from "./db-errors";

const WAITLIST_NOTE =
  "Veio da lista de espera — avise por WhatsApp que a vaga foi confirmada.";

/**
 * Chamada logo após um Appointment ser marcado CANCELLED (mesma transação).
 * Se houver alguém esperando por ESSE agendamento específico, cria
 * automaticamente um novo Appointment pro primeiro da fila (mesmo horário,
 * serviço e profissional) e marca a entrada como cumprida.
 *
 * Não há canal de notificação automática — o `notes` do novo agendamento
 * lembra o dono de avisar manualmente. O cliente logado vê a reserva nova em
 * "Minhas reservas"; se não quiser mais, cancela normalmente por lá.
 *
 * Lock por advisory lock (mesmo padrão de invitations.ts) pra dois
 * cancelamentos/retries concorrentes do mesmo agendamento não preencherem a
 * fila duas vezes.
 */
export async function fulfillWaitlistOnCancel(
  tx: Tx,
  appointmentId: string,
  salonId: string,
): Promise<{ appointmentId: string; clientId: string } | null> {
  await tx.$queryRaw`
    SELECT 1::integer AS "locked"
    FROM pg_advisory_xact_lock(
      hashtextextended(${`waitlist:${appointmentId}`}, 0)
    )
  `;

  const entry = await tx.waitlistEntry.findFirst({
    where: { appointmentId, salonId, fulfilledAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true, guestName: true, guestPhone: true },
  });
  if (!entry) return null;

  const original = await tx.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      serviceId: true,
      professionalId: true,
      startAt: true,
      endAt: true,
      priceCents: true,
    },
  });
  if (!original) return null;

  let clientId = entry.clientId;
  if (!clientId) {
    if (!entry.guestName) return null; // dado incompleto — não deveria acontecer
    const guest = await tx.clientProfile.create({
      data: { salonId, name: entry.guestName, phone: entry.guestPhone },
      select: { id: true },
    });
    clientId = guest.id;
  }

  try {
    const created = await tx.appointment.create({
      data: {
        salonId,
        clientId,
        serviceId: original.serviceId,
        professionalId: original.professionalId,
        startAt: original.startAt,
        endAt: original.endAt,
        priceCents: original.priceCents,
        status: "CONFIRMED",
        notes: WAITLIST_NOTE,
      },
      select: { id: true, clientId: true },
    });
    await tx.waitlistEntry.update({
      where: { id: entry.id },
      data: { fulfilledAt: new Date(), fulfilledAppointmentId: created.id },
    });
    return { appointmentId: created.id, clientId: created.clientId };
  } catch (e) {
    // Corrida rara: algo mais ocupou o horário entre o cancelamento e aqui.
    // Deixa a entrada em espera — ela é reavaliada no próximo cancelamento
    // que afetar esse agendamento (ex.: se o novo ocupante também cancelar).
    if (isOverlapViolation(e)) return null;
    throw e;
  }
}
