"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, LogOut, XCircle, RefreshCw, Repeat } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { logoutClient } from "../auth-actions";
import type { ClientSession } from "@/lib/client-auth";

type Appt = {
  id: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  status: string;
  version: number;
  service: { id: string; name: string; colorHex: string | null };
  serviceItems: { serviceId: string; serviceName: string }[];
  events: Array<{
    id: string;
    eventType: string;
    actorType: string;
    actorName: string | null;
    reason: string | null;
    createdAt: string;
    previousStartAt: string | null;
    startAt: string | null;
  }>;
  professional: { id: string; user: { name: string } };
  products: { quantity: number; priceCentsUnit: number; product: { name: string } }[];
};

export function MinhasList({
  appointments,
  salonSlug,
  currency,
  timezone,
  cancelPolicyHours,
  session,
}: {
  appointments: Appt[];
  salonSlug: string;
  currency: string;
  timezone: string;
  cancelPolicyHours: number;
  session: ClientSession;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelKeys = useRef(new Map<string, string>());

  const activeStatuses = new Set(["PENDING", "CONFIRMED", "IN_PROGRESS"]);
  const upcoming = appointments.filter(
    (appointment) =>
      activeStatuses.has(appointment.status) && !isPast(new Date(appointment.endAt)),
  );
  const past = appointments.filter(
    (appointment) =>
      !activeStatuses.has(appointment.status) || isPast(new Date(appointment.endAt)),
  );

  async function callCancel(appointment: Appt): Promise<string | null> {
    const idempotencyKey =
      cancelKeys.current.get(appointment.id) ?? crypto.randomUUID();
    cancelKeys.current.set(appointment.id, idempotencyKey);
    try {
      const res = await fetch("/api/client/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonSlug,
          appointmentId: appointment.id,
          expectedVersion: appointment.version,
          idempotencyKey,
        }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (res.ok) {
        cancelKeys.current.delete(appointment.id);
        return null;
      }
      if (responseBody.error === "ALREADY_CLOSED") return "Essa reserva já foi encerrada.";
      if (responseBody.error === "UNAUTHENTICATED") return "Sua sessão expirou — entre novamente.";
      if (responseBody.error === "TOO_LATE")
        return "O prazo de cancelamento terminou. Entre em contato com o estabelecimento.";
      if (responseBody.error === "ALREADY_STARTED")
        return "Não é possível cancelar uma reserva que já começou.";
      if (responseBody.error === "VERSION_CONFLICT")
        return "A reserva foi alterada em outra tela. Atualize e tente novamente.";
      return "Não foi possível cancelar. Tente de novo em instantes.";
    } catch {
      return "Sem conexão. Tente novamente; sua solicitação não será duplicada.";
    }
  }

  function confirmCancel() {
    if (!cancelTarget) return;
    setError(null);
    startTransition(async () => {
      const appointment = appointments.find((item) => item.id === cancelTarget);
      const err = appointment
        ? await callCancel(appointment)
        : "Reserva não encontrada. Atualize a página.";
      setCancelTarget(null);
      if (err) setError(err);
      else router.refresh();
    });
  }

  function goRemark(a: Appt) {
    // Não cancela antes: a rota de reagendamento atualiza a mesma reserva
    // (ver api/client/reschedule) — assim ela nunca conta como cancelamento
    // nas métricas, e o cliente não fica sem reserva ativa se desistir no meio.
    const serviceIds = a.serviceItems.length > 0
      ? a.serviceItems.map((service) => service.serviceId)
      : [a.service.id];
    const params = new URLSearchParams({
      services: serviceIds.join(","),
      pro: a.professional.id,
      reschedule: a.id,
      version: String(a.version),
    });
    router.push(`/book/${salonSlug}/agendar?${params}`);
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
          const canCancel =
            new Date(a.startAt).getTime() - Date.now() >=
            cancelPolicyHours * 60 * 60 * 1_000;
          return (
            <ApptCard
              key={a.id}
              a={a}
              currency={currency}
              timezone={timezone}
              actions={
                <div className="flex gap-3">
                  <button
                    onClick={() => goRemark(a)}
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

      {/* History */}
      <Section title="Histórico" empty="Sem histórico ainda.">
        {past.map((a) => (
          <ApptCard
            key={a.id}
            a={a}
            currency={currency}
            timezone={timezone}
            actions={
              <Link
                href={`/book/${salonSlug}/agendar?services=${encodeURIComponent(
                  (a.serviceItems.length > 0
                    ? a.serviceItems.map((service) => service.serviceId)
                    : [a.service.id]
                  ).join(","),
                )}`}
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
  timezone,
  actions,
}: {
  a: Appt;
  currency: string;
  timezone: string;
  actions?: React.ReactNode;
}) {
  const start = new Date(a.startAt);
  const productsTotal = a.products.reduce((s, p) => s + p.quantity * p.priceCentsUnit, 0);
  const total = a.priceCents + productsTotal;
  const serviceName = a.serviceItems.length > 0
    ? a.serviceItems.map((service) => service.serviceName).join(" + ")
    : a.service.name;

  const statusLabel =
    a.status === "CANCELLED"
      ? "Cancelado"
      : a.status === "COMPLETED"
        ? "Concluído"
        : a.status === "NO_SHOW"
          ? "Não compareceu"
          : a.status === "IN_PROGRESS"
            ? "Em atendimento"
            : a.status === "PENDING"
              ? "Pendente"
              : "Confirmado";

  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{serviceName}</p>
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
          {formatInTimeZone(start, timezone, "dd 'de' MMM · HH:mm", { locale: ptBR })}
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
      {a.events.length > 1 && (
        <details className="mt-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
          <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-muted-foreground">
            Ver histórico ({a.events.length})
          </summary>
          <ol className="space-y-2 border-l border-border pb-2 pl-3 text-[11px]">
            {a.events.map((event) => (
              <li key={event.id}>
                <p className="font-medium">{clientEventTitle(event.eventType)}</p>
                {event.eventType === "RESCHEDULED" && event.previousStartAt && event.startAt && (
                  <p className="text-muted-foreground">
                    {formatInTimeZone(new Date(event.previousStartAt), timezone, "dd/MM/yyyy HH:mm")} →{" "}
                    {formatInTimeZone(new Date(event.startAt), timezone, "dd/MM/yyyy HH:mm")}
                  </p>
                )}
                <p className="text-muted-foreground">
                  {event.actorName ?? clientActorName(event.actorType)} ·{" "}
                  {formatInTimeZone(new Date(event.createdAt), timezone, "dd/MM/yyyy HH:mm")}
                </p>
                {event.reason && <p className="text-muted-foreground">Motivo: {event.reason}</p>}
              </li>
            ))}
          </ol>
        </details>
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

function clientEventTitle(eventType: string): string {
  return {
    CREATED: "Reserva criada",
    RESCHEDULED: "Reserva remarcada",
    STATUS_CHANGED: "Status atualizado",
    CANCELLED: "Reserva cancelada",
    WAITLIST_FULFILLED: "Vaga confirmada",
    REMINDER_MARKED: "Lembrete enviado",
  }[eventType] ?? "Reserva atualizada";
}

function clientActorName(actorType: string): string {
  return {
    CLIENT: "Você",
    STAFF: "Estabelecimento",
    SYSTEM: "Sistema",
    GUEST: "Visitante",
  }[actorType] ?? "Sistema";
}
