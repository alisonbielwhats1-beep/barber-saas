import type { Tx } from "./prisma-tenant";
import { lockAppointmentOperationalScope } from "./appointment-service";
import { dateKeyInTimeZone } from "./time";
import { writeAuditLog } from "./audit";

export async function checkInAppointment(tx: Tx, input: {
  salonId: string; appointmentId: string; expectedVersion: number; userId: string; now?: Date;
}) {
  await lockAppointmentOperationalScope(tx, input);
  const appointment = await tx.appointment.findFirst({ where: { id: input.appointmentId, salonId: input.salonId } });
  if (!appointment) throw new Error("Reserva não encontrada.");
  if (!["PENDING", "CONFIRMED"].includes(appointment.status)) throw new Error("Só é possível registrar a chegada antes de iniciar o atendimento.");
  const salon = await tx.salon.findUniqueOrThrow({ where: { id: input.salonId }, select: { timezone: true } });
  const now = input.now ?? new Date();
  if (dateKeyInTimeZone(appointment.startAt, salon.timezone) !== dateKeyInTimeZone(now, salon.timezone)) throw new Error("A chegada só pode ser registrada no dia da reserva.");
  if (appointment.checkedInAt) return appointment.checkedInAt;
  if (appointment.version !== input.expectedVersion) throw new Error("A reserva mudou. Atualize a página antes de registrar a chegada.");
  const updated = await tx.appointment.updateMany({
    where: { id: appointment.id, salonId: input.salonId, version: input.expectedVersion, checkedInAt: null, status: { in: ["PENDING", "CONFIRMED"] } },
    data: { checkedInAt: now, checkedInById: input.userId, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new Error("A reserva mudou. Atualize a página.");
  await writeAuditLog(tx, { salonId: input.salonId, userId: input.userId, actorName: "Equipe", action: "APPOINTMENT_CHECKED_IN", entityType: "Appointment", entityId: appointment.id, occurredAt: now, metadata: { checkedInAt: now.toISOString(), startAt: appointment.startAt.toISOString(), version: input.expectedVersion } });
  return now;
}
