"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, LogOut, XCircle, RefreshCw, Repeat } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { format, isPast, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { logoutClient } from "../auth-actions";
import type { ClientSession } from "@/lib/client-auth";

type Appt = {
  id: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  status: string;
  service: { id: string; name: string; colorHex: string | null };
  professional: { id: string; user: { name: string } };
  products: { quantity: number; priceCentsUnit: number; product: { name: string } }[];
};

export function MinhasList({
  appointments,
  salonSlug,
  currency,
  session,
}: {
  appointments: Appt[];
  salonSlug: string;
  currency: string;
  session: ClientSession;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [remarkTarget, setRemarkTarget] = useState<Appt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upcoming = appointments.filter(
    (a) => !isPast(new Date(a.endAt)) && a.status !== "CANCELLED",
  );
  const past = appointments.filter(
    (a) => isPast(new Date(a.endAt)) || a.status === "CANCELLED",
  );

  async function callCancel(appointmentId: string): Promise<string | null> {
    const res = await fetch("/api/client/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salonSlug, appointmentId }),
    });
    if (res.ok) return null;
    const b = await res.json().catch(() => ({}));
    if (b.error === "ALREADY_CLOSED") return "Essa reserva já foi encerrada.";
    if (b.error === "UNAUTHENTICATED") return "Sua sessão expirou — entre novamente.";
    if (b.error === "TOO_LATE_TO_CANCEL")
      return "Não é possível cancelar com tão pouca antecedência. Entre em contato com o salão.";
    return "Não foi possível cancelar. Tente de novo em instantes.";
  }

  function confirmCancel() {
    if (!cancelTarget) return;
    setError(null);
    startTransition(async () => {
      const err = await callCancel(cancelTarget);
      setCancelTarget(null);
      if (err) setError(err);
      else router.refresh();
    });
  }

  function confirmRemark() {
    if (!remarkTarget) return;
    setError(null);
    startTransition(async () => {
      const err = await callCancel(remarkTarget.id);
      const target = remarkTarget;
      setRemarkTarget(null);
      if (err) {
        setError(err);
      } else {
        router.push(
          `/book/${salonSlug}/agendar?service=${target.service.id}&pro=${target.professional.id}`,
        );
      }
    });
  }

  function logout() {
    startTransition(() => logoutClient(salonSlug));
  }

  return (
    <>
      {/* Profile card */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
        <div>
          <p className="font-medium">{session.name}</p>
          <p className="text-xs text-muted-foreground">{session.email}</p>
        </div>
        <button
          onClick={logout}
          disabled={pending}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Upcoming */}
      <Section title="Próximas" empty="Nenhuma reserva futura.">
        {upcoming.map((a) => {
          const hoursUntil = differenceInHours(new Date(a.startAt), new Date());
          const canCancel = hoursUntil > 2;
          return (
            <ApptCard
              key={a.id}
              a={a}
              currency={currency}
              salonSlug={salonSlug}
              actions={
                <div className="flex gap-3">
                  <button
                    onClick={() => setRemarkTarget(a)}
                    disabled={pending || !canCancel}
                    title={!canCancel ? "Muito próximo para remarcar" : undefined}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary disabled:opacity-40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Remarcar
                  </button>
                  <button
                    onClick={() => setCancelTarget(a.id)}
                    disabled={pending || !canCancel}
                    title={!canCancel ? "Muito próximo para cancelar" : undefined}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 disabled:opacity-40"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Cancelar
                  </button>
                </div>
              }
            />
          );
        })}
      </Section>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Cancelar reserva?"
        description="O horário será liberado para outras pessoas. Você pode agendar de novo quando quiser."
        confirmLabel="Cancelar reserva"
        onConfirm={confirmCancel}
        pending={pending}
      />

      <ConfirmDialog
        open={remarkTarget !== null}
        onOpenChange={(o) => !o && setRemarkTarget(null)}
        title="Remarcar reserva?"
        description="A reserva atual será cancelada e você poderá escolher um novo horário para o mesmo serviço."
        confirmLabel="Remarcar"
        onConfirm={confirmRemark}
        pending={pending}
      />

      {/* History */}
      <Section title="Histórico" empty="Sem histórico ainda.">
        {past.map((a) => (
          <ApptCard
            key={a.id}
            a={a}
            currency={currency}
            salonSlug={salonSlug}
            actions={
              <Link
                href={`/book/${salonSlug}/agendar?service=${a.service.id}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              >
                <Repeat className="h-3.5 w-3.5" /> Agendar de novo
              </Link>
            }
          />
        ))}
      </Section>

      {/* CTA if no appointments */}
      {appointments.length === 0 && (
        <Link
          href={`/book/${salonSlug}/agendar`}
          className="block rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center text-sm font-medium text-primary"
        >
          Fazer meu primeiro agendamento →
        </Link>
      )}
    </>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      {hasChildren ? (
        <div className="space-y-3">{children}</div>
      ) : (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {empty}
        </p>
      )}
    </section>
  );
}

function ApptCard({
  a,
  currency,
  salonSlug: _salonSlug,
  actions,
}: {
  a: Appt;
  currency: string;
  salonSlug: string;
  actions?: React.ReactNode;
}) {
  const start = new Date(a.startAt);
  const productsTotal = a.products.reduce((s, p) => s + p.quantity * p.priceCentsUnit, 0);
  const total = a.priceCents + productsTotal;

  const statusLabel =
    a.status === "CANCELLED"
      ? "Cancelado"
      : a.status === "COMPLETED"
        ? "Concluído"
        : "Confirmado";

  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{a.service.name}</p>
          <p className="text-xs text-muted-foreground">com {a.professional.user.name}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            a.status === "CANCELLED"
              ? "bg-red-500/10 text-red-500"
              : a.status === "COMPLETED"
                ? "bg-muted text-muted-foreground"
                : "bg-primary/15 text-primary"
          }`}
        >
          {statusLabel}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5" />
          {format(start, "dd 'de' MMM · HH:mm", { locale: ptBR })}
        </span>
      </div>
      {a.products.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg bg-muted/40 p-2 text-xs">
          {a.products.map((p, i) => (
            <p key={i} className="flex justify-between">
              <span>
                {p.quantity}× {p.product.name}
              </span>
              <span>{formatMoney(p.quantity * p.priceCentsUnit, currency)}</span>
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">
          Total {formatMoney(total, currency)}
        </span>
        {actions}
      </div>
    </article>
  );
}
