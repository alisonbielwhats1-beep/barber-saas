import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { SharePage } from "./share-page";

export default async function CompartilharPage() {
  const { salonId } = await getTenantContext();

  const salon = await prisma.salon.findUniqueOrThrow({
    where: { id: salonId },
    select: { name: true, slug: true, plan: true, phone: true },
  });

  // Detecta a URL real (funciona em localhost e produção)
  const host = headers().get("host") ?? "salon-saas-ruby.vercel.app";
  const protocol = host.includes("localhost") ? "http" : "https";
  const bookingUrl = `${protocol}://${host}/book/${salon.slug}`;

  return <SharePage salon={salon} bookingUrl={bookingUrl} />;
}
