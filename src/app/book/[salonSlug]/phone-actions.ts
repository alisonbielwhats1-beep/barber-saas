"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { isValidPhoneBR, normalizePhone } from "@/lib/phone";
import { writeAuditLog } from "@/lib/audit";

export async function saveClientPhone(salonSlug: string, phone: string) {
  const parsed = z.object({ salonSlug: z.string().max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), phone: z.string().trim().max(32).refine(isValidPhoneBR).transform(normalizePhone) }).safeParse({ salonSlug, phone });
  if (!parsed.success) return { error: "Informe um telefone válido com DDD." };
  const session = await getClientSession();
  const saved = await withSalonBySlug(parsed.data.salonSlug, async (tx, salonId) => {
    const client = await resolveClientSessionInTenant(tx, session, salonId);
    if (!client) return false;
    await tx.clientProfile.updateMany({ where: { id: client.clientId, salonId, mergedIntoId: null }, data: { phone: parsed.data.phone, phoneNormalized: parsed.data.phone } });
    await writeAuditLog(tx, { salonId, userId: null, actorName: client.name, action: "CLIENT_PHONE_UPDATED", entityType: "ClientProfile", entityId: client.clientId, metadata: { source: "client-profile" } });
    return true;
  });
  if (!saved) return { error: "Entre novamente para atualizar seu telefone." };
  revalidatePath("/book", "layout");
  revalidatePath("/clientes");
  revalidatePath("/agenda");
  return { success: true as const };
}
