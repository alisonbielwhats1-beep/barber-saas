import { formatInTimeZone } from "date-fns-tz";
import { Banknote, CalendarClock, CircleDollarSign, CreditCard, ReceiptText, WalletCards } from "lucide-react";
import { deriveCashState } from "@/lib/operational-flows";
import { withTenant } from "@/lib/prisma-tenant";
import { requireRole, FINANCE_ROLES } from "@/lib/tenant";
import { endExclusiveOfDateInTimeZone, startOfDateInTimeZone } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import { CashControls, DepositControls } from "./payment-controls";

const METHOD: Record<string, string> = { CASH: "Dinheiro", CREDIT_CARD: "Crédito", DEBIT_CARD: "Débito", PIX: "Pix", TRANSFER: "Transferência" };

export default async function PagamentosPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const now = new Date();
  const data = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({ where: { id: ctx.salonId }, select: { timezone: true } });
    if (!salon) throw new Error("Estabelecimento não encontrado");
    const dateKey = formatInTimeZone(now, salon.timezone, "yyyy-MM-dd");
    const from = startOfDateInTimeZone(dateKey, salon.timezone);
    const to = endExclusiveOfDateInTimeZone(dateKey, salon.timezone);
    const cashEvents = await tx.auditLog.findMany({
      where: { salonId: ctx.salonId, entityType: "CashRegister", action: { in: ["CASH_OPENED", "CASH_CLOSED"] } },
      orderBy: { createdAt: "desc" }, take: 30,
      select: { action: true, createdAt: true, metadata: true, actorName: true, reason: true },
    });
    const todayPayments = await tx.payment.findMany({
      where: { paidAt: { gte: from, lt: to }, appointment: { salonId: ctx.salonId } },
      orderBy: { paidAt: "desc" },
      select: { id: true, amountCents: true, discountCents: true, method: true, paidAt: true, appointment: { select: { client: { select: { name: true } }, service: { select: { name: true } } } } },
    });
    const recentPayments = await tx.payment.findMany({
      where: { appointment: { salonId: ctx.salonId } }, orderBy: { paidAt: "desc" }, take: 20,
      select: { id: true, amountCents: true, method: true, paidAt: true, appointment: { select: { client: { select: { name: true } }, service: { select: { name: true } } } } },
    });
    const unpaid = await tx.appointment.findMany({
      where: { salonId: ctx.salonId, status: "COMPLETED", payment: null }, orderBy: { startAt: "desc" }, take: 20,
      select: { id: true, priceCents: true, startAt: true, client: { select: { name: true } }, service: { select: { name: true } } },
    });
    const upcoming = await tx.appointment.findMany({
      where: { salonId: ctx.salonId, status: { in: ["PENDING", "CONFIRMED"] }, startAt: { gte: now } }, orderBy: { startAt: "asc" }, take: 12,
      select: { id: true, priceCents: true, startAt: true, client: { select: { name: true } }, service: { select: { name: true } } },
    });
    const depositEvents = upcoming.length === 0 ? [] : await tx.auditLog.findMany({
      where: { salonId: ctx.salonId, action: "DEPOSIT_STATUS_CHANGED", entityType: "Appointment", entityId: { in: upcoming.map((item) => item.id) } },
      orderBy: { createdAt: "desc" }, select: { entityId: true, metadata: true },
    });
    return { timezone: salon.timezone, cashEvents, todayPayments, recentPayments, unpaid, upcoming, depositEvents };
  });

  const cash = deriveCashState(data.cashEvents);
  const totalToday = data.todayPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const cashToday = data.todayPayments.filter((payment) => payment.method === "CASH").reduce((sum, payment) => sum + payment.amountCents, 0);
  const expectedCash = cash.openingFloatCents + cashToday;
  const receivable = data.unpaid.reduce((sum, item) => sum + item.priceCents, 0);
  const depositStatus = new Map<string, string>();
  for (const event of data.depositEvents) {
    if (depositStatus.has(event.entityId)) continue;
    const metadata = event.metadata as Record<string, unknown> | null;
    if (typeof metadata?.status === "string") depositStatus.set(event.entityId, metadata.status);
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Financeiro</p>
        <h1 className="text-[26px] font-semibold tracking-tight">Pagamentos e caixa</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">Controle manual, sem taxas de transação e conectado às comandas.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric icon={CircleDollarSign} label="Recebido hoje" value={formatMoney(totalToday)} />
        <Metric icon={Banknote} label="Dinheiro esperado" value={formatMoney(expectedCash)} />
        <Metric icon={ReceiptText} label="A receber" value={formatMoney(receivable)} />
        <Metric icon={WalletCards} label="Atendimentos pendentes" value={data.unpaid.length.toString()} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold">Abertura e fechamento</h2>
              <p className="text-[11px] text-muted-foreground">{cash.isOpen ? `Aberto desde ${formatInTimeZone(cash.openedAt!, data.timezone, "HH:mm")}` : "Caixa fechado"}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${cash.isOpen ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{cash.isOpen ? "ABERTO" : "FECHADO"}</span>
          </div>
          <CashControls isOpen={cash.isOpen} expectedCashCents={cash.isOpen ? expectedCash : 0} />
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card lg:col-span-2">
          <div className="border-b border-border px-5 py-3.5"><h2 className="text-[14px] font-semibold">Recebimentos recentes</h2></div>
          {data.recentPayments.length === 0 ? <Empty text="Nenhum recebimento registrado." /> : data.recentPayments.map((payment) => (
            <div key={payment.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:px-5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-success/10 text-success"><CreditCard className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{payment.appointment.client.name}</p><p className="truncate text-[11px] text-muted-foreground">{payment.appointment.service.name} · {METHOD[payment.method]}</p></div>
              <div className="text-right"><p className="text-[13px] font-semibold">{formatMoney(payment.amountCents)}</p><p className="text-[10px] text-muted-foreground">{formatInTimeZone(payment.paidAt, data.timezone, "dd/MM · HH:mm")}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Comandas aguardando recebimento" count={data.unpaid.length}>
          {data.unpaid.length === 0 ? <Empty text="Todas as comandas concluídas estão pagas." /> : data.unpaid.map((item) => (
            <div key={item.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:px-5"><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{item.client.name}</p><p className="text-[11px] text-muted-foreground">{item.service.name} · {formatInTimeZone(item.startAt, data.timezone, "dd/MM · HH:mm")}</p></div><p className="text-[13px] font-semibold text-warning">{formatMoney(item.priceCents)}</p></div>
          ))}
        </Panel>
        <Panel title="Sinais dos próximos horários" count={data.upcoming.length}>
          {data.upcoming.length === 0 ? <Empty text="Nenhum horário futuro aguardando sinal." /> : data.upcoming.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:px-5"><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{item.client.name}</p><p className="text-[11px] text-muted-foreground">{item.service.name} · {formatInTimeZone(item.startAt, data.timezone, "dd/MM · HH:mm")}</p></div><DepositControls appointmentId={item.id} amountCents={Math.round(item.priceCents * 0.3)} status={depositStatus.get(item.id) ?? null} /></div>
          ))}
        </Panel>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3.5"><h2 className="text-[14px] font-semibold">Histórico do caixa</h2></div>
        {data.cashEvents.length === 0 ? <Empty text="Abra o primeiro caixa para iniciar o histórico." /> : data.cashEvents.slice(0, 10).map((event, index) => (
          <div key={`${event.createdAt.toISOString()}-${index}`} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0"><CalendarClock className="h-4 w-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-[12px] font-medium">{event.action === "CASH_OPENED" ? "Caixa aberto" : "Caixa fechado"} por {event.actorName}</p><p className="truncate text-[10px] text-muted-foreground">{event.reason || "Sem observação"}</p></div><p className="text-[11px] text-muted-foreground">{formatInTimeZone(event.createdAt, data.timezone, "dd/MM/yyyy · HH:mm")}</p></div>
        ))}
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof CreditCard; label: string; value: string }) { return <div className="rounded-xl border border-border bg-card p-4"><Icon className="mb-3 h-4 w-4 text-primary" /><p className="text-xl font-semibold tracking-tight">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>; }
function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-3.5"><h2 className="text-[14px] font-semibold">{title}</h2><span className="rounded-full bg-surface-1 px-2 py-0.5 text-[10px] text-muted-foreground">{count}</span></div>{children}</div>; }
function Empty({ text }: { text: string }) { return <p className="p-8 text-center text-[12px] text-muted-foreground">{text}</p>; }
