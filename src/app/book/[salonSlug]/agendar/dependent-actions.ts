"use server";
import { z } from "zod";
import { withClientPortal } from "@/lib/client-portal";
export async function listDependents(salonId: string) {
  return withClientPortal(salonId, (tx, clientId) => tx.clientDependent.findMany({ where: { salonId, clientId, active: true }, select: { id: true, name: true, relationship: true }, orderBy: { name: "asc" } }));
}
export async function createDependent(salonId: string, input: { id: string; name: string; relationship: string }) {
  const data = z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(120), relationship: z.string().trim().min(2).max(80) }).parse(input);
  return withClientPortal(salonId, async (tx, clientId) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`dependents:${salonId}:${clientId}`},0))`;
    const previous = await tx.clientDependent.findFirst({ where: { id: data.id, clientId, salonId } });
    if (previous) { if (previous.name !== data.name || previous.relationship !== data.relationship) throw new Error("Pedido alterado. Tente novamente."); return { id: previous.id }; }
    if (await tx.clientDependent.count({ where: { salonId, clientId, active: true } }) >= 20) throw new Error("Limite de 20 pessoas por titular.");
    return tx.clientDependent.create({ data: { ...data, salonId, clientId }, select: { id: true } });
  });
}
export async function archiveDependent(salonId: string, id: string) {
  await withClientPortal(salonId, (tx, clientId) => tx.clientDependent.updateMany({ where: { id, salonId, clientId }, data: { active: false } }));
}
