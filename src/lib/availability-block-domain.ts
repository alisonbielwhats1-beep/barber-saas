import { z } from "zod";
import { createHash } from "node:crypto";
import type { Tx } from "./prisma-tenant";
import { availabilityOccurrences } from "./availability-recurrence";
import { lockOperationalResources } from "./inventory-lock";
import { writeAuditLog } from "./audit";
export const inputSchema = z.object({
  id: z.string().uuid(),
  professionalIds: z.array(z.string().min(1)).min(1).max(100),
  startLocal: z.string().min(16).max(16),
  endLocal: z.string().min(16).max(16),
  reason: z.string().trim().max(200),
  everyWeeks: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]).optional(),
  count: z.number().int().min(1).max(52).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(v => Boolean(v.weekdays) === Boolean(v.untilDate), "Informe dias e data final juntos.");

export function expandBlock(data: z.infer<typeof inputSchema>, timezone: string) {
  const intervals = availabilityOccurrences(data.startLocal, data.endLocal, timezone, data.everyWeeks, data.count, data.weekdays && data.untilDate ? { weekdays: data.weekdays, untilDate: data.untilDate } : undefined);
  if (intervals.length * new Set(data.professionalIds).size > 200) throw new Error("Selecione até 200 bloqueios por pedido. Reduza a data final ou os profissionais; para uma rotina fixa, use Pausa recorrente.");
  return intervals;
}


/** Existing agenda executor, shared without changing collision/recurrence semantics. */
export async function executeAvailabilityBlock(tx:Tx,ctx:{salonId:string;userId:string;role:string},input:unknown){
 if(!["OWNER","MANAGER","PROFESSIONAL"].includes(ctx.role))throw Error("FORBIDDEN");
 const data=inputSchema.parse(input);
      const ids = [...new Set(data.professionalIds)].sort();
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`availability-request:${ctx.salonId}:${data.id}`}, 0))`;
      const fingerprint = createHash("sha256").update(JSON.stringify({ ...data, professionalIds: ids, everyWeeks: data.everyWeeks ?? 0, count: data.count ?? 1 })).digest("hex");
      const request = await tx.auditLog.findFirst({ where: { salonId: ctx.salonId, action: "AVAILABILITY_REQUEST", entityId: data.id }, select: { reason: true } });
      if (request && request.reason !== fingerprint) throw new Error("O pedido mudou. Feche e abra o formulário para tentar novamente.");
      const pros = await tx.professional.findMany({ where: { salonId: ctx.salonId, id: { in: ids }, active: true, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) }, select: { id: true } });
      if (pros.length !== ids.length) throw new Error("Profissional inválido para este estabelecimento.");
      await lockOperationalResources(tx, { professionalIds: ids });
      const salon = await tx.salon.findUniqueOrThrow({ where: { id: ctx.salonId }, select: { timezone: true } });
      const intervals = expandBlock(data, salon.timezone);
      // Stable ids make a retry harmless; a changed payload with the same id fails closed.
      for (const id of request ? [] : ids) {
       for (const [index, { startAt, endAt }] of intervals.entries()) {
        const blockId = `${data.id}:${id}${index ? `:${index}` : ""}`;
        const previous = await tx.timeOff.findFirst({ where: { id: blockId, professional: { salonId: ctx.salonId, ...(ctx.role === "PROFESSIONAL" ? { userId: ctx.userId } : {}) } } });
        if (previous) {
          if (+previous.startAt !== +startAt || +previous.endAt !== +endAt || previous.reason !== data.reason) throw new Error("O pedido mudou. Feche e abra o formulário para tentar novamente.");
          continue;
        }
        await tx.timeOff.create({ data: { id: blockId, professionalId: id, startAt, endAt, reason: data.reason } });
        await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_BLOCKED", entityType: "TimeOff", entityId: blockId, reason: data.reason, metadata: { professionalId: id, startAt: startAt.toISOString(), endAt: endAt.toISOString() } });
       }
      }
      if (!request) await writeAuditLog(tx, { salonId: ctx.salonId, userId: ctx.userId, actorName: "Equipe", action: "AVAILABILITY_REQUEST", entityType: "TimeOff", entityId: data.id, reason: fingerprint, metadata: { occurrences: intervals.length, professionalIds: ids } });
      return tx.appointment.findMany({ where: { salonId: ctx.salonId, professionalId: { in: ids }, OR: intervals.map(({ startAt, endAt }) => ({ startAt: { lt: endAt }, endAt: { gt: startAt } })), status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] } }, select: { id: true, version: true, startAt: true, client: { select: { name: true } } }, orderBy: { startAt: "asc" } });
}
