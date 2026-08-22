import { CheckCircle2, Clock3, ReceiptText, TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { isPlatformBillingEnabled } from "@/lib/platform-billing";
import { withUser } from "@/lib/prisma-tenant";
import { InvoiceActions, NewInvoiceButton } from "./billing-controls";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function dateLabel(value: Date) {
  return value.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export default async function PlatformBillingPage() {
  if (!isPlatformBillingEnabled()) redirect("/plataforma");
  const admin = await getPlatformAdminContext();
  const [salons, invoices] = await withUser(admin.userId, (tx) =>
    Promise.all([
      tx.salon.findMany({
        where: { accessStatus: "APPROVED", plan: { not: "FREE" } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      tx.platformInvoice.findMany({
        orderBy: [{ dueDate: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true,
          reference: true,
          amountCents: true,
          dueDate: true,
          paidDate: true,
          paymentMethod: true,
          status: true,
          notes: true,
          salon: { select: { name: true } },
        },
      }),
    ]),
  );

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const isOverdue = (invoice: (typeof invoices)[number]) =>
    invoice.status === "OPEN" && invoice.dueDate.getTime() < todayUtc.getTime();
  const open = invoices.filter((invoice) => invoice.status === "OPEN" && !isOverdue(invoice));
  const overdue = invoices.filter(isOverdue);
  const paid = invoices.filter((invoice) => invoice.status === "PAID");

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Controle manual</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Cobranças da plataforma</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Mensalidades dos planos pagos. Este módulo registra recebimentos, mas não cobra cartões nem contrata serviço externo.
          </p>
        </div>
        <NewInvoiceButton salons={salons} />
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Em aberto" value={money.format(open.reduce((sum, item) => sum + item.amountCents, 0) / 100)} icon={Clock3} />
        <Metric label="Vencido" value={money.format(overdue.reduce((sum, item) => sum + item.amountCents, 0) / 100)} icon={TriangleAlert} />
        <Metric label="Recebido" value={money.format(paid.reduce((sum, item) => sum + item.amountCents, 0) / 100)} icon={CheckCircle2} />
        <Metric label="Estabelecimentos Pro" value={String(salons.length)} icon={ReceiptText} />
      </section>

      {invoices.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center">
          <ReceiptText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma cobrança manual registrada.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {invoices.map((invoice) => {
            const overdueStatus = isOverdue(invoice);
            const statusLabel = invoice.status === "PAID" ? "Pago" : invoice.status === "VOID" ? "Anulado" : overdueStatus ? "Vencido" : "Em aberto";
            return (
              <article key={invoice.id} className="rounded-3xl border border-border bg-card p-5">
                <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold">{invoice.salon.name}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs ${invoice.status === "PAID" ? "bg-emerald-500/10 text-emerald-400" : invoice.status === "VOID" ? "bg-muted text-muted-foreground" : overdueStatus ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-400"}`}>{statusLabel}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{invoice.reference} · vence em {dateLabel(invoice.dueDate)}</p>
                    <p className="mt-2 text-xl font-semibold tabular-nums">{money.format(invoice.amountCents / 100)}</p>
                    {invoice.paidDate && <p className="mt-1 text-xs text-muted-foreground">Baixa em {dateLabel(invoice.paidDate)} · {invoice.paymentMethod ?? "forma não informada"}</p>}
                    {invoice.notes && <p className="mt-3 max-w-2xl rounded-xl bg-background px-3 py-2 text-xs text-muted-foreground">{invoice.notes}</p>}
                  </div>
                  {invoice.status === "OPEN" && <InvoiceActions invoiceId={invoice.id} />}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock3 }) {
  return <article className="rounded-2xl border border-border bg-card p-5"><Icon className="h-5 w-5 text-muted-foreground" /><p className="mt-5 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></article>;
}
