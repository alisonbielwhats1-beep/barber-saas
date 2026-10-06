import Link from "next/link";
import { billingEnabled } from "@/lib/billing/config";

/**
 * Próximo passo exibido nas telas de recursos bloqueados no plano Grátis.
 * Só o proprietário acessa `/assinatura`; os demais papéis são orientados a
 * falar com ele. Sem contratação online disponível não há para onde enviar.
 */
export function PlanUpgradeAction({ role, className = "" }: { role: string; className?: string }) {
  if (role === "OWNER") {
    if (!billingEnabled()) return null;
    return (
      <Link
        href="/assinatura"
        className={`inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 ${className}`.trim()}
      >
        Ver planos pagos
      </Link>
    );
  }
  return (
    <span className={`block text-muted-foreground ${className}`.trim()}>
      Peça ao proprietário do estabelecimento para contratar um plano pago.
    </span>
  );
}
