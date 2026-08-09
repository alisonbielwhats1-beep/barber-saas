import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/client-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { ClientShell } from "./client-shell";
import { BusinessExperienceProvider } from "@/components/business-experience-provider";
import { getBusinessExperience } from "@/config/business-experience";

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
  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: { segment: true },
  });
  const experience = getBusinessExperience(salon?.segment);
  const unreadNotifications = session
    ? (await withSalonBySlug(salonSlug, (tx, salonId) => {
        if (session.salonId !== salonId) return Promise.resolve(0);
        return tx.notificationOutbox.count({
          where: {
            salonId,
            recipientKey: `CLIENT:${session.clientId}`,
            channel: "INTERNAL",
            readAt: null,
          },
        });
      })) ?? 0
    : 0;

  return (
    <BusinessExperienceProvider segment={salon?.segment}>
      <div
        data-theme="salon-dark"
        data-business-experience={experience.id}
        data-experience-direction={experience.visual.direction}
        data-experience-density={experience.visual.density}
        data-public-layout={experience.visual.publicLayout}
        className="experience-scope min-h-dvh text-foreground"
      >
        <ClientShell salonSlug={salonSlug} unreadNotifications={unreadNotifications}>
          {children}
        </ClientShell>
      </div>
    </BusinessExperienceProvider>
  );
}
