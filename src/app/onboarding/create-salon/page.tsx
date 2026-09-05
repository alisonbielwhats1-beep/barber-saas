import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { EstablishmentShell } from "@/components/marketing/establishment-shell";
import { withUser } from "@/lib/prisma-tenant";
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

  // Quem já tem estabelecimento não tem o que fazer aqui. withUser, não
  // prisma cru: mesma razão do guard em actions.ts — sob RLS, Membership só
  // é legível com a GUC de usuário setada.
  const memberships = await withUser(session.user.id, (tx) =>
    tx.membership.count({ where: { userId: session.user.id } }),
  );
  if (memberships > 0) redirect("/dashboard");

  return (<EstablishmentShell onboarding><CreateSalonForm /></EstablishmentShell>);
}
