"use server";

import { z } from "zod";
import { assertRole, getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { hiddenClientIds } from "@/lib/client-list-visibility";

export async function searchAppointmentClients(query: string) {
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST", "PROFESSIONAL"]);
  const term = z.string().trim().min(2).max(100).parse(query);
  return withTenant(ctx, async tx => {
    const own = ctx.role === "PROFESSIONAL"
      ? await tx.professional.findFirst({ where: { salonId: ctx.salonId, userId: ctx.userId, active: true }, select: { id: true } })
      : null;
    if (ctx.role === "PROFESSIONAL" && !own) return [];
    const hidden = await hiddenClientIds(tx, ctx.salonId);
    const digits = term.replace(/\D/g, "");
    return tx.clientProfile.findMany({
      where: {
        salonId: ctx.salonId, mergedIntoId: null, id: { notIn: [...hidden] },
        ...(own ? { appointments: { some: { professionalId: own.id } } } : {}),
        OR: [
          { AND: term.split(/\s+/).map(word => ({ name: { contains: word, mode: "insensitive" as const } })) },
          ...(digits.length >= 2 ? [{ phone: { contains: digits } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true },
      orderBy: [{ name: "asc" }, { id: "asc" }], take: 50,
    });
  });
}
