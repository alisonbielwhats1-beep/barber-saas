import Link from "next/link";
import { ChevronRight, Crown } from "lucide-react";
import type { BillingTone } from "@/lib/billing/presentation";

const dot: Record<BillingTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-foreground",
};
const attention: Partial<Record<BillingTone, string>> = {
  warn: "border-warning/50",
  danger: "border-danger/60",
};

/**
 * Owner shortcut to the subscription page. A neutral chip for a healthy plan;
 * the border and dot only draw attention when the owner needs to act.
 */
export function PlanShortcut({
  plan,
  href,
  status = null,
  tone = "neutral",
  compact = false,
}: {
  plan: string | null;
  href: string;
  status?: string | null;
  tone?: BillingTone;
  compact?: boolean;
}) {
  if (!plan) {
    return (
      <Link
        href={href}
        aria-label="Ativar plano"
        title="Ativar plano"
        className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${compact ? "px-3 text-xs" : "px-4 text-sm"}`}
      >
        <Crown className="h-4 w-4 shrink-0" aria-hidden="true" />
        Ativar plano
      </Link>
    );
  }
  const label = status
    ? `Plano: ${plan}. Situação: ${status}. Abrir plano e assinatura`
    : `Plano atual: ${plan}. Alterar plano`;
  return (
    <Link
      href={href}
      aria-label={label}
      title={status ? `${plan} · ${status}` : `${plan} · Alterar plano`}
      className={`group inline-flex min-h-11 max-w-full items-center rounded-full border bg-card text-left text-foreground shadow-sm transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${attention[tone] ?? "border-border"} ${compact ? "min-w-0 gap-1.5 py-1 pl-1.5 pr-2.5" : "gap-2.5 py-1 pl-1.5 pr-3"}`}
    >
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-full bg-warning/15 text-warning ${compact ? "h-7 w-7" : "h-8 w-8"}`}
      >
        <Crown className="h-4 w-4" />
      </span>
      <span className="min-w-0 leading-4">
        <span className={`block truncate font-semibold ${compact ? "text-xs" : "text-sm"}`}>{plan}</span>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          {status && <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[tone]}`} />}
          <span className="truncate">{status ?? "Alterar plano"}</span>
        </span>
      </span>
      {!compact && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      )}
    </Link>
  );
}
