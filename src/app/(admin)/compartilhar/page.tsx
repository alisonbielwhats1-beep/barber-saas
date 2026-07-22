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

  // Usa NEXTAUTH_URL como URL canônica (evita URLs de preview da Vercel).
  // Localmente: http://localhost:3001 — produção: https://salon-saas-ruby.vercel.app
  const nextAuthUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  const host = headers().get("host") ?? "salon-saas-ruby.vercel.app";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = nextAuthUrl ?? `${protocol}://${host}`;
  const bookingUrl = `${baseUrl}/book/${salon.slug}`;

  return <SharePage salon={salon} bookingUrl={bookingUrl} />;
}
