import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { assertSecretaryEnvironment } from "@/lib/salon-secretary-runtime";
import { PageHeader } from "@/components/page-header";
import { SecretaryEntry } from "./secretary-dock";
import { assertSecretaryRolloutAccess } from "@/lib/secretary-rollout";

export default async function SecretaryPage() {
  try { assertSecretaryEnvironment(); } catch { notFound(); }
  if (process.env.SALON_SECRETARY_FRONT_ENABLED !== "true") notFound();
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  try { assertSecretaryRolloutAccess(ctx); } catch { notFound(); }
  return <section className="space-y-4 lg:space-y-6">
    <PageHeader title="Sua Secretária" />
    <div className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-4 sm:flex-row sm:items-center lg:p-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(var(--selection))] text-[hsl(var(--selection-foreground))]"><Sparkles className="h-5 w-5" /></span>
        <p className="min-w-0 text-sm text-muted-foreground">Abra o painel para conversar. A conversa acompanha você pela agenda, serviços, clientes e estoque.</p>
      </div>
      <SecretaryEntry />
    </div>
  </section>;
}
