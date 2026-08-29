import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { resolveClientSessionInTenant } from "@/lib/public-appointment";
import { ClientShell } from "./client-shell";

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
    manifest: `/book/${salonSlug}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: salon?.name ?? "SalonSaaS",
    },
  };
}

/**
 * Route layout do lado cliente. Aplica o tema `salon-dark` via data-attribute
 * na div raiz — as CSS variables em globals.css `[data-theme="salon-dark"]`
 * ganham daquele ponto pra baixo. A cor personalizada fica exclusivamente no
 * painel do dono; a jornada pública mantém o verde padrão do aplicativo.
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
