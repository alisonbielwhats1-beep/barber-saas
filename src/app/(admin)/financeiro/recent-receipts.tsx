import { requireRole, FINANCE_ROLES } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { formatInTimeZone } from "date-fns-tz";
import { formatMoney } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { ReceiptButton } from "./receipt-button";
export async function RecentReceipts() {
  const ctx = await requireRole(FINANCE_ROLES);
  const data = await withTenant(ctx, async (tx) => ({
    salon: await tx.salon.findUniqueOrThrow({
      where: { id: ctx.salonId },
      select: { timezone: true, currency: true },
    }),
    rows: await tx.payment.findMany({
      where: { appointment: { salonId: ctx.salonId } },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        id: true,
        appointmentId: true,
        paidAt: true,
        recordedAt: true,
        amountCents: true,
        currency: true,
        appointment: {
          select: { client: { select: { name: true } }, dependentName: true },
        },
      },
    }),
  }));
  return (
    <details className="group/recent overflow-hidden rounded-[14px] border border-border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 text-sm font-semibold transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          Últimos 20 recebimentos
          <span className="block text-xs font-normal text-muted-foreground">Os mais recentes primeiro</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/recent:rotate-180" />
      </summary>
      <div className="max-h-96 divide-y divide-border overflow-y-auto overscroll-contain border-t border-border">
        {!data.rows.length && (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum recebimento registrado.</p>
        )}
        {data.rows.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {p.appointment.dependentName ?? p.appointment.client.name} ·{" "}
                <span className="whitespace-nowrap tabular-nums">{formatMoney(p.amountCents, p.currency)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Recebido em{" "}
                {formatInTimeZone(p.paidAt, data.salon.timezone, "dd/MM/yyyy")}{" "}
                · registrado em{" "}
                {formatInTimeZone(
                  p.recordedAt,
                  data.salon.timezone,
                  "dd/MM/yyyy HH:mm",
                )}
              </p>
            </div>
            <ReceiptButton id={p.appointmentId} />
          </div>
        ))}
      </div>
    </details>
  );
}
