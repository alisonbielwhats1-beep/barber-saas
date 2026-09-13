"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getClientSession } from "@/lib/client-auth";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { respondToOffer } from "@/lib/waitlist-offers";
export async function respondOffer(slug: string, id: string, accept: boolean) {
  z.string().min(1).max(100).parse(slug);
  z.string().min(1).max(100).parse(id);
  z.boolean().parse(accept);
  const session = await getClientSession();
  const result = await withSalonBySlug(slug, async (tx, salonId) => {
    const client = await resolveClientSessionInTenant(tx, session, salonId);
    if (!client) throw new Error("Entre na sua conta para responder à oferta.");
    return respondToOffer(tx, salonId, client.clientId, id, accept);
  });
  revalidatePath(`/book/${slug}`, "layout");
  revalidatePath("/agenda");
  return result;
}
