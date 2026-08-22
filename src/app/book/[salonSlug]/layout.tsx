import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { ClientShell } from "./client-shell";
import { hexToHslTriple, readableForeground } from "@/lib/color";

/**
 * Título por salão — lido direto (Salon tem leitura pública nas policies de
 * RLS, mesma razão documentada em `lib/slug.ts`). Sem isso, toda página de
 * `/book/*` mostrava o mesmo título de marca genérico, incorreto pra
 * qualquer salão que não fosse aquele específico.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}): Promise<Metadata> {
  const { salonSlug } = await params;
  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: { name: true },
  });
  return {
    title: salon ? `${salon.name} — agendamento online` : "SalonSaaS",
  };
}

/**
 * Route layout do lado cliente. Aplica o tema `salon-dark` via data-attribute
 * na div raiz — as CSS variables em globals.css `[data-theme="salon-dark"]`
 * ganham daquele ponto pra baixo.
 *
 * Também restringe a largura ao formato "mobile" (max 480px) centralizando,
 * pra que a experiência pareça um app tanto em celular quanto em desktop.
 */
export default async function BookLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ salonSlug: string }>;
}) {
  const [{ salonSlug }, session] = await Promise.all([params, getClientSession()]);
  const shellData = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const effectiveSession = await resolveClientSessionInTenant(tx, session, salonId);
    const [salon, unreadNotifications] = await Promise.all([
      tx.salon.findUnique({
        where: { id: salonId },
        select: { themeColorHex: true },
      }),
      effectiveSession
        ? tx.notificationOutbox.count({
            where: {
              salonId,
              recipientKey: `CLIENT:${effectiveSession.clientId}`,
              channel: "INTERNAL",
              readAt: null,
            },
          })
        : Promise.resolve(0),
    ]);
    return { salon, unreadNotifications };
  });
  const brandHex = shellData?.salon?.themeColorHex ?? null;
  const brandHsl = hexToHslTriple(brandHex);
  const brandStyle = brandHsl
    ? ({
        "--primary": brandHsl,
        "--accent": brandHsl,
        "--ring": brandHsl,
        "--primary-foreground": readableForeground(brandHex) ?? "0 0% 100%",
      } as CSSProperties)
    : undefined;

  return (
    <div
      data-theme="salon-dark"
      style={brandStyle}
      className="min-h-dvh bg-background text-foreground"
    >
      <ClientShell salonSlug={salonSlug} unreadNotifications={shellData?.unreadNotifications ?? 0}>
        {children}
      </ClientShell>
    </div>
  );
}
