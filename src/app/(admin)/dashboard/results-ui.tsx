import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Peças visuais comuns de Resultados (Visão geral, Financeiro e Relatórios), no
 * padrão do protótipo aprovado: cartão de indicador com pastilha de 28 px na cor
 * do significado, valor de 24 px sem centavos e linhas de resumo do celular.
 * Só apresentação: os valores chegam prontos do servidor.
 */

type IconType = React.ComponentType<{ className?: string }>;

/** Cor do significado: lilás = ativo/principal, verde = deu certo, âmbar = espera ação, vermelho = despesa/problema. */
export type Tone = "accent" | "success" | "warning" | "danger" | "neutral";

export const TONE_CHIP: Record<Tone, string> = {
  accent: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-muted text-muted-foreground",
};

const wholeMoney = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Valor de resumo, sem centavos: "R$ 5.738" (o espaço do Intl já é sem quebra). Recebe centavos. */
export function formatMoneyWhole(cents: number) {
  return wholeMoney.format(Math.round(cents / 100) || 0);
}

/** Valor de destaque: a partir de R$ 1 milhão vira "R$ 2,22 mi" para caber no cartão. */
export function formatMoneyHero(cents: number) {
  const reais = cents / 100;
  if (Math.abs(reais) < 1_000_000) return formatMoneyWhole(cents);
  const mi = (Math.abs(reais) / 1_000_000).toFixed(2).replace(".", ",");
  return `${reais < 0 ? "-" : ""}R$ ${mi} mi`;
}

export function ToneChip({ icon: Icon, tone = "neutral", size = "sm" }: { icon: IconType; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center",
        size === "sm" ? "h-7 w-7 rounded-[8px]" : "h-8 w-8 rounded-[9px]",
        TONE_CHIP[tone],
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** Variação contra o período anterior: verde na alta, vermelho na queda, sempre com seta e texto. */
export function TrendBadge({ change }: { change: number }) {
  const up = change >= 0;
  const pct = Math.abs(change * 100).toFixed(0);
  return (
    <span
      aria-label={`${up ? "Alta" : "Queda"} de ${pct}% contra o período anterior`}
      className={cn(
        "inline-flex min-h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium tabular-nums",
        up ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
      )}
    >
      {up ? <TrendingUp aria-hidden="true" className="h-3 w-3" /> : <TrendingDown aria-hidden="true" className="h-3 w-3" />}
      {pct}%
    </span>
  );
}

/** Título de seção 14/600 com apoio de 12 px; o bloco da direita não encolhe. */
export function SectionTitle({ id, title, sub, right, as: Heading = "h2" }: {
  id?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading id={id} className="text-sm font-semibold leading-snug">{title}</Heading>
        {sub ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{sub}</p> : null}
      </div>
      {right ?? null}
    </div>
  );
}

/** Cartão de indicador: rótulo 12/500, pastilha no canto, valor 24/600 numa linha e apoio de 12 px. */
export function KpiCard({
  label,
  value,
  full,
  icon,
  tone = "accent",
  hint,
  change,
  featured = false,
  href,
  className,
}: {
  label: string;
  value: string;
  /** Valor completo, quando o cartão mostra a forma curta. */
  full?: string;
  icon: IconType;
  tone?: Tone;
  hint?: React.ReactNode;
  change?: number | null;
  featured?: boolean;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <span className="flex min-h-[34px] items-start justify-between gap-2">
        <span className="min-w-0 text-xs font-medium leading-snug text-muted-foreground">{label}</span>
        <ToneChip icon={icon} tone={tone} />
      </span>
      <span className="block truncate text-2xl font-semibold leading-tight tracking-tight tabular-nums" title={full && full !== value ? full : undefined}>
        {value}
      </span>
      {change != null || hint ? (
        <span className="flex min-h-[22px] flex-wrap items-center gap-x-2 gap-y-1.5 text-xs leading-snug text-muted-foreground">
          {change != null ? <TrendBadge change={change} /> : null}
          {hint ? <span className="min-w-0">{hint}</span> : null}
        </span>
      ) : null}
    </>
  );
  const box = cn(
    "flex min-w-0 flex-col gap-2 rounded-[14px] border bg-card p-4",
    featured ? "border-border-strong" : "border-border",
    href && "transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  return href ? <a href={href} className={box}>{body}</a> : <div className={box}>{body}</div>;
}

/** Linha de lista do celular: título e apoio à esquerda, valor (e variação) à direita. */
export function SummaryRow({ label, hint, value, change, valueClassName, href, trailing }: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: React.ReactNode;
  change?: number | null;
  valueClassName?: string;
  href?: string;
  trailing?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span className={cn("whitespace-nowrap text-base font-semibold tabular-nums", valueClassName)}>{value}</span>
        {change != null ? <TrendBadge change={change} /> : null}
      </span>
      {trailing}
    </>
  );
  const row = "flex min-h-14 items-center justify-between gap-3 py-2";
  return href
    ? <a href={href} className={cn(row, "-mx-4 px-4 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}>{body}</a>
    : <div className={row}>{body}</div>;
}

/** Selo neutro do período ("30 dias"). */
export function PeriodBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-[22px] items-center rounded-full bg-muted px-2.5 text-xs font-medium text-foreground">
      {children}
    </span>
  );
}
