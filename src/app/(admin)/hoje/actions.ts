"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { checkInAppointment } from "@/lib/appointment-checkin";

export async function registerArrival(input: { appointmentId: string; expectedVersion: number }) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  const parsed = z.object({ appointmentId: z.string().min(1), expectedVersion: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { error: "Reserva inválida." };
  try {
    await withTenant(ctx, tx => checkInAppointment(tx, { ...parsed.data, salonId: ctx.salonId, userId: ctx.userId }));
    revalidatePath("/hoje"); revalidatePath("/agenda");
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Não foi possível registrar a chegada." }; }
}
