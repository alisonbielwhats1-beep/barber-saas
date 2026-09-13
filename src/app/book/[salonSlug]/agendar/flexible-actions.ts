"use server";
import { lockOperationalResources } from "@/lib/inventory-lock";
import { flexibleInput, joinFlexibleWaitlist } from "@/lib/flexible-waitlist";
import { withClientPortal } from "@/lib/client-portal";
import type { z } from "zod";
export async function requestFlexibleWaitlist(salonId: string, input: z.infer<typeof flexibleInput>) {
  await withClientPortal(salonId, (tx, clientId) => joinFlexibleWaitlist(tx, salonId, clientId, input));
}
export async function myFlexibleWaitlist(salonId: string) {
  return withClientPortal(salonId, (tx, clientId) => tx.flexibleWaitlist.findMany({ where: { salonId, clientId }, select: { id: true, fromDate: true, toDate: true, startMinutes: true, endMinutes: true, status: true, professional: { select: { user: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: 30 }));
}
export async function cancelFlexibleRequest(salonId: string, id: string) {
  await withClientPortal(salonId, async (tx, clientId) => {
    const request = await tx.flexibleWaitlist.findFirst({ where: { id, salonId, clientId } });
    if (!request) throw new Error("Pedido não encontrado.");
    await lockOperationalResources(tx, { professionalIds: [request.professionalId] });
    await tx.waitlistOffer.updateMany({ where: { salonId, waitlistId: id, status: "OFFERED" }, data: { status: "WITHDRAWN" } });
    await tx.flexibleWaitlist.updateMany({ where: { id, salonId, clientId, status: "WAITING" }, data: { status: "CANCELLED" } });
  });
}
