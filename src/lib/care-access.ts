import type { Tx } from "./prisma-tenant";
export async function requireCareAppointment(tx: Tx, ctx: { salonId: string; userId: string; role: string }, appointmentId: string) {
  if (!["OWNER", "MANAGER", "PROFESSIONAL"].includes(ctx.role)) throw new Error("Sem permissão para o histórico de cuidados.");
  const appointment = await tx.appointment.findFirst({ where: { id: appointmentId, salonId: ctx.salonId, ...(ctx.role === "PROFESSIONAL" ? { professional: { userId: ctx.userId, salonId: ctx.salonId } } : {}) }, select: { id: true, status: true, startAt: true } });
  if (!appointment) throw new Error("Atendimento não encontrado.");
  return appointment;
}
