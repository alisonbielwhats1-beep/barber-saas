import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Check, Sparkles } from "lucide-react";
import { withUser } from "@/lib/prisma-tenant";
import { authOptions } from "@/lib/auth";
import { ProductWordmark } from "@/components/product-wordmark";
import { CreateSalonForm } from "./create-salon-form";

/**
 * Destino do redirect em `getTenantContext()` para usuário sem membership.
 * A rota já era referenciada em lib/tenant.ts e no matcher do middleware, mas
 * nunca existiu — quem caísse aqui via um 404 sem saída.
 *
 * Dois caminhos chegam nesta tela:
 *  - conta nova que ainda não tem estabelecimento;
 *  - alguém removido da equipe em /configuracoes (o User continua existindo
 *    sem nenhuma membership).
 * O texto atende os dois sem afirmar qual é o caso.
 */
export default async function CreateSalonPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  // Quem já tem estabelecimento não tem o que fazer aqui. withUser, não
  // prisma cru: mesma razão do guard em actions.ts — sob RLS, Membership só
  // é legível com a GUC de usuário setada.
  const memberships = await withUser(session.user.id, (tx) =>
    tx.membership.count({ where: { userId: session.user.id } }),
  );
  if (memberships > 0) redirect("/dashboard");

  return (
    <main
      data-theme="salon-dark"
      data-business-experience="espaco-misto"
      data-experience-direction="modular"
      className="experience-scope min-h-dvh bg-background px-4 py-5 sm:px-6 sm:py-8"
    >
      <div className="mx-auto w-full max-w-7xl">
        <ProductWordmark className="mb-6" />

        <div className="grid overflow-hidden rounded-[2rem] border border-border bg-card/40 shadow-2xl lg:min-h-[calc(100dvh-8rem)] lg:grid-cols-[0.72fr_1.28fr]">
          <aside className="relative hidden overflow-hidden border-r border-border bg-[radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.2),transparent_45%),linear-gradient(145deg,hsl(var(--surface-1)),hsl(var(--background)))] p-10 lg:flex lg:flex-col lg:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Configuração inteligente
              </span>
              <h1 className="mt-7 max-w-md font-display text-5xl leading-[1.02] tracking-[-0.04em]">
                Seu espaço começa com a experiência certa.
              </h1>
              <p className="mt-5 max-w-md text-[15px] leading-7 text-muted-foreground">
                Escolha o tipo de negócio e o SalonSaaS prepara linguagem, organização e serviços iniciais para a sua rotina.
              </p>
            </div>

            <div className="space-y-3">
              {[
                "Você pode alterar os serviços depois",
                "Nenhuma escolha limita seu catálogo",
                "Configuração inicial em poucos minutos",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm text-foreground/85">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/12 text-primary">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </aside>

          <div className="p-4 sm:p-7 lg:p-10 xl:p-12">
            <header className="mb-8 max-w-2xl sm:mb-10">
              <div className="mb-5 flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/2 rounded-full bg-primary" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">1 de 2</span>
              </div>
              <h2 className="text-[30px] font-semibold leading-[1.08] tracking-tight sm:text-[38px]">
                Vamos criar seu estabelecimento
              </h2>
              <p className="mt-3 max-w-xl text-[14px] leading-6 text-muted-foreground sm:text-[15px]">
                Conte como funciona o seu negócio. Você poderá ajustar todos os detalhes depois.
              </p>
            </header>

            <div className="experience-surface-raised p-4 sm:p-6 lg:p-7">
              <CreateSalonForm />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
