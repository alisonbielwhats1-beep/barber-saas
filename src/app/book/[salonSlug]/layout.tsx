import type { Metadata } from "next";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { ClientShell } from "./client-shell";
import { PWA_APPLE_ICON, PWA_FAVICON } from "@/lib/pwa-icons";
import "./client-theme.css";

/**
 * O mesmo gate transacional da página protege os metadados: um salão suspenso
 * não pode continuar expondo nome nem manifesto específico pelo HTML.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}): Promise<Metadata> {
  const { salonSlug } = await params;
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) =>
    tx.salon.findUnique({
      where: { id: salonId },
      select: { name: true },
    }),
  );
  return {
    title: salon ? `${salon.name} — agendamento online` : "Everflair",
    manifest: `/book/${salonSlug}/manifest.webmanifest`,
    icons: { icon: PWA_FAVICON, apple: PWA_APPLE_ICON },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: salon?.name ?? "Everflair",
    },
  };
}

/**
 * Route layout do lado cliente. Aplica o tema `salon-dark` via data-attribute
 * na div raiz — as CSS variables em globals.css `[data-theme="salon-dark"]`
 * ganham daquele ponto pra baixo. A jornada pública usa a mesma paleta neutra da operação,
 * com cores semânticas reservadas aos status.
 *
 * Mantém a leitura confortável no celular e amplia progressivamente a área
 * útil em tablets e desktops, sem transformar a jornada em uma página esticada.
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
    const unreadNotifications = effectiveSession
      ? await tx.notificationOutbox.count({
          where: {
            salonId,
            recipientKey: `CLIENT:${effectiveSession.clientId}`,
            channel: "INTERNAL",
            readAt: null,
          },
        })
      : 0;
    return { unreadNotifications };
  });

  return (
    <div
      data-theme="salon-dark"
      className="min-h-dvh bg-background text-foreground"
    >
      <ClientShell salonSlug={salonSlug} unreadNotifications={shellData?.unreadNotifications ?? 0}>
        {children}
      </ClientShell>
    </div>
  );
}
