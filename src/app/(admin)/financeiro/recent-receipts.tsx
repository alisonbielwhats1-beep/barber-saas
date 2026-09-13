import { requireRole, FINANCE_ROLES } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { formatInTimeZone } from "date-fns-tz";
import { formatMoney } from "@/lib/utils";
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
    <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">
        Últimos 20 recebimentos
      </summary>
      <div className="max-h-80 divide-y divide-border overflow-y-auto">
        {!data.rows.length && (
          <p className="py-3 text-sm">Nenhum recebimento registrado.</p>
        )}
        {data.rows.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="text-sm font-medium">
                {p.appointment.dependentName ?? p.appointment.client.name} ·{" "}
                {formatMoney(p.amountCents, p.currency)}
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
