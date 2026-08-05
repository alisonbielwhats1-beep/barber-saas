import type { Tx } from "./prisma-tenant";

/**
 * Bloqueio de salão inteiro (feriado, reforma, viagem) — diferente de
 * `TimeOff`, que é por profissional. Usado tanto pelo caminho público
 * (availability, appointments) quanto pelo admin (agenda/actions) pra
 * impedir novo agendamento na janela bloqueada. Não cancela retroativamente
 * o que já existia antes do bloqueio ser criado.
 */
export async function isSalonClosedAt(
  tx: Tx,
  salonId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const closure = await tx.salonClosure.findFirst({
    where: { salonId, startAt: { lt: endAt }, endAt: { gt: startAt } },
    select: { id: true },
  });
  return closure !== null;
}
