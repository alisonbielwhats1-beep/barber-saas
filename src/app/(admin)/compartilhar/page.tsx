import { headers } from "next/headers";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getPublicBookingUrl } from "@/lib/public-booking-url";
import { SharePage } from "./share-page";

export default async function CompartilharPage() {
  const ctx = await getTenantContext();
  const { salonId } = ctx;

  const salon = await withTenant(ctx, (tx) =>
    tx.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: { name: true, slug: true, plan: true, phone: true },
    }),
  );

  // Divulgação pode usar o domínio oficial sem mudar autenticação ou cookies.
  const host = (await headers()).get("host") ?? "salon-saas-ruby.vercel.app";
  const protocol = host.includes("localhost") ? "http" : "https";
  const bookingUrl = getPublicBookingUrl(salon.slug, `${protocol}://${host}`);

  return <SharePage salon={salon} bookingUrl={bookingUrl} />;
}
