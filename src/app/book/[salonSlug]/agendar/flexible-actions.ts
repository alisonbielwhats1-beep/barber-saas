"use server";
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
  await withClientPortal(salonId, (tx, clientId) => tx.flexibleWaitlist.updateMany({ where: { id, salonId, clientId, status: "WAITING" }, data: { status: "CANCELLED" } }));
}
