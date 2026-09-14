import { formatMoney } from "@/lib/utils";
import type { VisitPlan } from "@/lib/visit-plan";
import { VariablePriceNotice } from "@/components/service-price";
export function VisitSummary({
  plan,
  currency = "BRL",
}: {
  plan: VisitPlan;
  currency?: string;
}) {
  return (
    <section
      aria-label="Resumo da visita"
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
    >
      <h2 className="font-semibold">Sua visita</h2>
      <VariablePriceNotice services={plan.items} />
      <ol className="divide-y divide-border">
        {plan.items.map((item, index) => (
          <li
            key={index}
            className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-3 text-sm"
          >
            <div className="tabular-nums">
              {item.startLocal.slice(11, 16)}
              <span className="block text-xs text-muted-foreground">
                até {item.endLocal.slice(11, 16)}
              </span>
            </div>
            <div className="min-w-0">
              <p className="break-words font-medium">{item.serviceName}</p>
              <p className="text-muted-foreground">
                com {item.professionalName}
              </p>
              <p className="mt-1">
                {item.priceType === "FROM" ? "A partir de " : ""}
                {formatMoney(item.priceCents, currency)}
              </p>
              {item.priceNote && (
                <p className="text-xs text-muted-foreground">
                  {item.priceNote}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-sm font-semibold">
        <span>
          {plan.items.some((i) => i.priceType === "FROM")
            ? "Total a partir de"
            : "Total dos serviços"}
        </span>
        <span>{formatMoney(plan.totalCents, currency)}</span>
      </p>
    </section>
  );
}
