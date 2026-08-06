import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";

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
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-theme="salon-dark"
      className="min-h-dvh bg-background text-foreground"
    >
      <div className="mx-auto min-h-dvh w-full max-w-[480px] pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}
