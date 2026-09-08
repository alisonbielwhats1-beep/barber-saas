import type { Metadata } from "next";
import { cookies } from "next/headers";
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
 * The server restores the client's appearance cookie before the first paint.
 * ClientShell scopes tokens and portals independently from the admin theme.
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
  const [{ salonSlug }, session, cookieStore] = await Promise.all([params, getClientSession(), cookies()]);
  const initialTheme = cookieStore.get("everflair-client-theme")?.value === "light" ? "salon-light" : "salon-dark";
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
      <ClientShell initialTheme={initialTheme} salonSlug={salonSlug} unreadNotifications={shellData?.unreadNotifications ?? 0}>
        {children}
      </ClientShell>
  );
}
