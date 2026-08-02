import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
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

  // Quem já tem estabelecimento não tem o que fazer aqui.
  const memberships = await prisma.membership.count({
    where: { userId: session.user.id },
  });
  if (memberships > 0) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-10">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3 w-3" />
            Primeiro passo
          </span>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
            Vamos criar seu estabelecimento
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Sua conta ainda não está ligada a nenhum estabelecimento. Leva menos
            de um minuto — dá para ajustar tudo depois.
          </p>
        </header>

        <CreateSalonForm />
      </div>
    </main>
  );
}
