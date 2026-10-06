import { notFound } from "next/navigation";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { assertSecretaryEnvironment } from "@/lib/salon-secretary-runtime";
import { SecretaryEntry } from "./secretary-dock";
import { assertSecretaryRolloutAccess } from "@/lib/secretary-rollout";

export default async function SecretaryPage() {
  try { assertSecretaryEnvironment(); } catch { notFound(); }
  if (process.env.SALON_SECRETARY_FRONT_ENABLED !== "true") notFound();
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  try { assertSecretaryRolloutAccess(ctx); } catch { notFound(); }
  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold">Sua Secretária</h1>
    <p className="text-sm text-muted-foreground">Abra o painel para conversar. A conversa acompanha você pela agenda, serviços, clientes e estoque.</p>
    <SecretaryEntry />
  </section>;
}
