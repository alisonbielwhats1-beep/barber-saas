import { NextResponse } from "next/server";
import type { MetadataRoute } from "next";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { PWA_ICONS } from "@/lib/pwa-icons";

type ManifestRouteContext = {
  params: Promise<{ salonSlug: string }>;
};

/**
 * Manifesto específico do salão para que o atalho instalado abra a
 * experiência do cliente correta, e não a landing administrativa.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: ManifestRouteContext,
) {
  const { salonSlug } = await params;
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) =>
    tx.salon.findUnique({
      where: { id: salonId },
      select: { name: true },
    }),
  );

  if (!salon) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const clientPath = `/book/${salonSlug}`;
  const startPath = `${clientPath}/welcome`;
  const name = salon.name.trim() || "SalonSaaS";
  const manifest: MetadataRoute.Manifest = {
    id: clientPath,
    name: `${name} — agendamento online`,
    short_name: name.slice(0, 24),
    description: `Agende seu horário em ${name}.`,
    start_url: startPath,
    scope: `${clientPath}/`,
    display: "standalone",
    background_color: "#0b0b0d",
    theme_color: "#7df89b",
    lang: "pt-BR",
    icons: [...PWA_ICONS],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}
