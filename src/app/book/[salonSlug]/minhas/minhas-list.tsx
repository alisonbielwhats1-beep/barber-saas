"use client";
import { hasVariablePrice } from "@/lib/service-price";
import { VariablePriceNotice } from "@/components/service-price";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LogOut,
  RefreshCw,
  Repeat,
  Users,
  XCircle,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { addDays, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { logoutClient } from "../auth-actions";
import { ReviewDialog } from "./review-dialog";
import { SalonLocationLink } from "../salon-location-link";
import type { ClientSession } from "@/lib/client-auth";

type Appt = {
  dependentName?: string | null;
  id: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  status: string;
  version: number;
  _count: { waitlistEntries: number };
  service: { id: string; name: string; colorHex: string | null };
  serviceItems: { serviceId: string; serviceName: string; priceType?: string; priceNote?: string | null }[];
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
  review: {
    id: string;
    rating: number;
    comment: string | null;
    status: string;
    createdAt: string;
  } | null;
};

const PAST_PREVIEW_COUNT = 5;

type WaitlistItem = {
  id: string;
  position: number;
  startAt: string;
  timezone: string;
  serviceName: string;
  professionalName: string;
};

type PendingProposal = {
  id: string;
  appointmentId: string;
  currentStartAt: string;
  currentEndAt: string;
  currentTimezone: string;
  currentProfessionalName: string;
  targetStartAt: string;
  targetEndAt: string;
  targetTimezone: string;
  targetPriceCents: number;
  targetProfessionalName: string;
  targetServices: Array<{
    id: string;
    name: string;
    durationMin: number;
    priceCents: number;
    priceType?: string;
    priceNote?: string | null;
  }>;
  reason: string | null;
};

export function MinhasList({
  appointments,
  pendingProposals,
  waitlistEntries,
  salonSlug,
  currency,
  timezone,
  cancelPolicyHours,
  salonName,
  salonAddress,
  session,
}: {
  appointments: Appt[];
  pendingProposals: PendingProposal[];
  waitlistEntries: WaitlistItem[];
  salonSlug: string;
  currency: string;
  timezone: string;
  cancelPolicyHours: number;
  salonName: string;
  salonAddress: string | null;
  session: ClientSession;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [waitlistCancelTarget, setWaitlistCancelTarget] = useState<string | null>(null);
  const [proposalRejectTarget, setProposalRejectTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appointmentView, setAppointmentView] = useState<"upcoming" | "history">("upcoming");
  const [pastExpanded, setPastExpanded] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const cancelKeys = useRef(new Map<string, string>());

  const activeStatuses = new Set(["PENDING", "CONFIRMED", "IN_PROGRESS"]);
  const upcoming = appointments
    .filter(
      (appointment) =>
        activeStatuses.has(appointment.status) && !isPast(new Date(appointment.endAt)),
    )
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  const past = appointments.filter(
    (appointment) =>
      !activeStatuses.has(appointment.status) || isPast(new Date(appointment.endAt)),
  );
  const [nextAppointment, ...laterAppointments] = upcoming;
  const reviewAppointment = past.find(appointment => appointment.status === "COMPLETED" && !appointment.review);

  function respondToProposal(proposalId: string, decision: "ACCEPT" | "REJECT") {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/client/reschedule-proposal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salonSlug, proposalId, decision }),
        });
        const responseBody = await res.json().catch(() => ({}));
        if (!res.ok) {
          const messages: Record<string, string> = {
            AUTH_REQUIRED: "Sua sessão expirou — entre novamente.",
            SLOT_TAKEN: "Esse horário acabou de ser ocupado. Fale com o estabelecimento.",
            VERSION_CONFLICT: "A reserva mudou em outra tela. Atualize e tente novamente.",
            ALREADY_STARTED: "Essa reserva já começou e não pode ser alterada.",
            ALREADY_CLOSED: "Essa reserva já foi encerrada.",
            FORBIDDEN: "Essa solicitação não pertence à sua conta.",
          };
          setError(messages[responseBody.error] ?? "Não foi possível responder agora. Atualize e tente novamente.");
          return;
        }
        setProposalRejectTarget(null);
        router.refresh();
      } catch {
        setError("Sem conexão. Tente novamente; sua reserva continua protegida.");
      }
    });
  }

  function appointmentActions(appointment: Appt) {
    const canChange =
      new Date(appointment.startAt).getTime() - Date.now() >=
      cancelPolicyHours * 60 * 60 * 1_000;
    return (
      <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => goRemark(appointment)}
          disabled={pending || !canChange}
          title={!canChange ? "Muito próximo para remarcar" : undefined}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-40"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" /> Remarcar
        </button>
        <button
          type="button"
          onClick={() => setCancelTarget(appointment.id)}
          disabled={pending || !canChange}
          title={!canChange ? "Muito próximo para cancelar" : undefined}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
        >
          <XCircle aria-hidden="true" className="h-3.5 w-3.5" /> Cancelar
        </button>
      </div>
      {!canChange && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">O prazo para alterar pelo aplicativo terminou ({cancelPolicyHours}h antes). Para remarcar ou cancelar, entre em contato com o salão. <Link href={`/book/${salonSlug}#contato`} className="inline-flex min-h-11 items-center font-semibold underline">Ver contato do salão</Link></p>}
      </div>
    );
  }

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

  function confirmWaitlistCancel() {
    if (!waitlistCancelTarget) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/client/waitlist/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salonSlug, waitlistId: waitlistCancelTarget }),
        });
        const responseBody = await res.json().catch(() => ({}));
        setWaitlistCancelTarget(null);
        if (!res.ok) {
          setError(
            responseBody.error === "ALREADY_FULFILLED"
              ? "Essa vaga já foi confirmada para você. Atualize a página."
              : "Não foi possível sair da fila. Atualize e tente novamente.",
          );
          return;
        }
        router.refresh();
      } catch {
        setWaitlistCancelTarget(null);
        setError("Sem conexão. Tente novamente para sair da fila.");
      }
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
          type="button"
          onClick={logout}
          disabled={pending}
          className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-xs text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sair
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {pendingProposals.length > 0 && (
        <section aria-labelledby="pending-proposals-title" className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">Ação necessária</p>
            <h2 id="pending-proposals-title" className="text-base font-semibold">O estabelecimento sugeriu uma alteração</h2>
            <p className="mt-1 text-sm text-muted-foreground">Confira o novo horário e aceite ou recuse cada solicitação.</p>
          </div>
          {pendingProposals.map((proposal) => {
            const currentStart = new Date(proposal.currentStartAt);
            const targetStart = new Date(proposal.targetStartAt);
            const targetServiceName = proposal.targetServices.map((service) => service.name).join(" + ") || "Serviço";
            return (
              <article key={proposal.id} className="rounded-2xl border border-amber-500/35 bg-amber-500/5 p-4" aria-busy={pending}>
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-500/15 text-warning">
                    <Clock3 aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{targetServiceName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Solicitado pelo estabelecimento</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-xl bg-background/60 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Atual</p>
                    <p className="mt-1 font-medium">{formatInTimeZone(currentStart, proposal.currentTimezone, "dd/MM/yyyy 'às' HH:mm")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">com {proposal.currentProfessionalName}</p>
                  </div>
                  <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Novo horário</p>
                    <p className="mt-1 font-medium">{formatInTimeZone(targetStart, proposal.targetTimezone, "dd/MM/yyyy 'às' HH:mm")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">com {proposal.targetProfessionalName}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{hasVariablePrice(proposal.targetServices) ? "Novo valor inicial: " : "Novo valor: "}<strong className="text-foreground">{formatMoney(proposal.targetPriceCents, currency)}</strong></span>
                  {proposal.reason && <span>Motivo: {proposal.reason}</span>}
                </div>
                <VariablePriceNotice services={proposal.targetServices} />
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => respondToProposal(proposal.id, "ACCEPT")}
                    disabled={pending}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Aceitar novo horário
                  </button>
                  <button
                    type="button"
                    onClick={() => setProposalRejectTarget(proposal.id)}
                    disabled={pending}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold text-muted-foreground disabled:opacity-50"
                  >
                    <XCircle aria-hidden="true" className="h-4 w-4" /> Recusar
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <div
        role="tablist"
        aria-label="Reservas por período"
        className="grid grid-cols-2 rounded-2xl border border-border bg-muted/35 p-1"
      >
        <button
          type="button"
          role="tab"
          id="appointments-upcoming-tab"
          aria-selected={appointmentView === "upcoming"}
          aria-controls="appointments-upcoming-panel"
          onClick={() => setAppointmentView("upcoming")}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${appointmentView === "upcoming" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Próximos
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{upcoming.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="appointments-history-tab"
          aria-selected={appointmentView === "history"}
          aria-controls="appointments-history-panel"
          onClick={() => setAppointmentView("history")}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${appointmentView === "history" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Histórico
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{past.length}</span>
        </button>
      </div>

      {appointmentView === "upcoming" ? (
        <div
          role="tabpanel"
          id="appointments-upcoming-panel"
          aria-labelledby="appointments-upcoming-tab"
          className="space-y-6"
        >
          {nextAppointment ? (
            <section aria-labelledby="next-appointment-title">
              <div className="mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Próxima</p>
                <h2 id="next-appointment-title" className="text-base font-semibold">Seu próximo atendimento</h2>
              </div>
              <ApptCard
                a={nextAppointment}
                currency={currency}
                timezone={timezone}
                salonName={salonName}
                salonAddress={salonAddress}
                featured
                actions={appointmentActions(nextAppointment)}
              />
            </section>
          ) : (
            <section className="rounded-2xl border border-border bg-card p-5 text-center" aria-labelledby="no-upcoming-title">
              <CalendarDays aria-hidden="true" className="mx-auto h-6 w-6 text-muted-foreground" />
              <h2 id="no-upcoming-title" className="mt-3 font-semibold">Nenhum atendimento agendado</h2>
              <p className="mt-1 text-sm text-muted-foreground">Quando você reservar, o próximo horário aparecerá aqui.</p>
              <Link href={`/book/${salonSlug}/agendar`} className="client-booking-cta mt-4 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold">
                Agendar atendimento
              </Link>
            </section>
          )}

          {laterAppointments.length > 0 && (
            <Section title="Depois" empty="">
              {laterAppointments.map((appointment) => (
                <ApptCard
                  key={appointment.id}
                  a={appointment}
                  currency={currency}
                  timezone={timezone}
                  salonName={salonName}
                  salonAddress={salonAddress}
                  actions={appointmentActions(appointment)}
                />
              ))}
            </Section>
          )}

          {waitlistEntries.length > 0 && <Section title="Filas de espera" empty="">
            {waitlistEntries.map((entry) => (
              <article key={entry.id} className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{entry.serviceName}</p>
                    <p className="text-xs text-muted-foreground">com {entry.professionalName}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
                    Fila #{entry.position}
                  </span>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatInTimeZone(new Date(entry.startAt), entry.timezone, "dd 'de' MMM · HH:mm", { locale: ptBR })}
                </p>
                <p className="mt-3 flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Se a vaga ficar livre e você for o primeiro, sua visita será confirmada automaticamente.
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setWaitlistCancelTarget(entry.id)}
                  className="mt-3 min-h-11 text-xs font-medium text-danger disabled:opacity-50"
                >
                  Sair somente desta fila
                </button>
              </article>
            ))}
          </Section>}
        </div>
      ) : (
        <div
          role="tabpanel"
          id="appointments-history-panel"
          aria-labelledby="appointments-history-tab"
          className="space-y-6"
        >
          {reviewAppointment && !reviewDismissed && (
            <section aria-labelledby="review-prompt-title" className="rounded-2xl border border-primary/25 bg-primary/5 p-5">
              <p className="text-xs font-semibold text-primary">Sua última visita</p>
              <h2 id="review-prompt-title" className="mt-1 text-lg font-semibold">Como foi sua experiência no {salonName}?</h2>
              <p className="mt-2 text-sm text-muted-foreground">{reviewAppointment.serviceItems.map(service => service.serviceName).join(" + ") || reviewAppointment.service.name} · {formatInTimeZone(new Date(reviewAppointment.startAt), timezone, "dd/MM")} · com {reviewAppointment.professional.user.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">Dê sua nota. O comentário é opcional.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <ReviewDialog emphasized salonSlug={salonSlug} salonName={salonName} appointmentId={reviewAppointment.id} serviceName={reviewAppointment.serviceItems.map(service => service.serviceName).join(" + ") || reviewAppointment.service.name} />
                <button type="button" className="min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted" onClick={() => setReviewDismissed(true)}>Agora não</button>
              </div>
            </section>
          )}

          <Section
            title="Atendimentos anteriores"
            empty="Sem histórico ainda."
            action={
              past.length > PAST_PREVIEW_COUNT ? (
                <button
                  type="button"
                  onClick={() => setPastExpanded((open) => !open)}
                  className="min-h-11 text-xs font-medium text-primary hover:underline"
                >
                  {pastExpanded ? "Ver menos" : `Ver tudo (${past.length})`}
                </button>
              ) : undefined
            }
          >
            {(pastExpanded ? past : past.slice(0, PAST_PREVIEW_COUNT)).map((a) => (
              <ApptCard
                key={a.id}
                a={a}
                currency={currency}
                timezone={timezone}
                salonName={salonName}
                salonAddress={salonAddress}
                history
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    {a.status === "COMPLETED" && !a.review && (
                      <ReviewDialog
                        salonSlug={salonSlug}
                        salonName={salonName}
                        appointmentId={a.id}
                        serviceName={a.serviceItems.length > 0
                          ? a.serviceItems.map((service) => service.serviceName).join(" + ")
                          : a.service.name}
                      />
                    )}
                    {a.status === "COMPLETED" && a.review && (
                      <span className="inline-flex min-h-11 items-center gap-1.5 px-2 text-xs text-warning">
                        <span aria-hidden="true">★</span> Avaliado · {a.review.rating}/5
                      </span>
                    )}
                    <Link
                      href={`/book/${salonSlug}/agendar?services=${encodeURIComponent(
                        (a.serviceItems.length > 0
                          ? a.serviceItems.map((service) => service.serviceId)
                          : [a.service.id]
                        ).join(","),
                      )}`}
                      className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-primary"
                    >
                      <Repeat className="h-3.5 w-3.5" aria-hidden="true" /> Agendar de novo
                    </Link>
                  </div>
                }
              />
            ))}
          </Section>
        </div>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Cancelar reserva?"
        description={
          (appointments.find((appointment) => appointment.id === cancelTarget)?._count.waitlistEntries ?? 0) > 0
            ? "A primeira pessoa da fila será confirmada automaticamente neste horário. Somente a sua reserva será cancelada."
            : "O horário será liberado para outras pessoas. Você pode agendar de novo quando quiser."
        }
        confirmLabel="Cancelar reserva"
        onConfirm={confirmCancel}
        pending={pending}
      />

      <ConfirmDialog
        open={waitlistCancelTarget !== null}
        onOpenChange={(open) => !open && setWaitlistCancelTarget(null)}
        title="Sair da fila de espera?"
        description="Somente sua posição nesta fila será removida. O agendamento confirmado e as outras pessoas não serão alterados."
        confirmLabel="Sair desta fila"
        onConfirm={confirmWaitlistCancel}
        pending={pending}
      />

      <ConfirmDialog
        open={proposalRejectTarget !== null}
        onOpenChange={(open) => !open && setProposalRejectTarget(null)}
        title="Recusar alteração?"
        description="O horário atual continuará reservado. O estabelecimento será avisado da sua recusa."
        confirmLabel="Recusar alteração"
        onConfirm={() => proposalRejectTarget && respondToProposal(proposalRejectTarget, "REJECT")}
        pending={pending}
      />

    </>
  );
}

function Section({
  title,
  empty,
  action,
  children,
}: {
  title: string;
  empty: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {action}
      </div>
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
  salonName,
  salonAddress,
  featured = false,
  history = false,
  actions,
}: {
  a: Appt;
  currency: string;
  timezone: string;
  salonName: string;
  salonAddress: string | null;
  featured?: boolean;
  history?: boolean;
  actions?: React.ReactNode;
}) {
  const start = new Date(a.startAt);
  const productsTotal = a.products.reduce((s, p) => s + p.quantity * p.priceCentsUnit, 0);
  const variablePrice = hasVariablePrice(a.serviceItems);
  const total = a.priceCents + productsTotal;
  const durationMinutes = Math.max(0, Math.round((new Date(a.endAt).getTime() - start.getTime()) / 60_000));
  const serviceName = a.serviceItems.length > 0
    ? a.serviceItems.map((service) => service.serviceName).join(" + ")
    : a.service.name;

  const ended = isPast(new Date(a.endAt));
  const isUnclosedPast = history && ended && ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(a.status);
  const statusLabel = isUnclosedPast
    ? "Atendimento passado"
    :
    a.status === "CANCELLED"
      ? "Cancelado"
      : a.status === "COMPLETED"
        ? "Concluído"
        : a.status === "NO_SHOW"
          ? "Não compareceu"
          : a.status === "IN_PROGRESS"
            ? "Em atendimento"
            : a.status === "PENDING"
              ? "Aguardando confirmação"
              : "Confirmado";
  const statusTone = isUnclosedPast
    ? "neutral"
    : a.status === "CANCELLED" || a.status === "NO_SHOW"
      ? "danger"
      : a.status === "PENDING"
        ? "warning"
        : a.status === "IN_PROGRESS"
          ? "info"
          : a.status === "COMPLETED"
            ? "complete"
            : "success";
  const dateKey = formatInTimeZone(start, timezone, "yyyy-MM-dd");
  const todayKey = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const tomorrowKey = formatInTimeZone(addDays(new Date(), 1), timezone, "yyyy-MM-dd");
  const relativeDate = dateKey === todayKey ? "Hoje" : dateKey === tomorrowKey ? "Amanhã" : null;
  const StatusIcon = isUnclosedPast || a.status === "PENDING"
    ? Clock3
    : a.status === "CANCELLED" || a.status === "NO_SHOW"
      ? AlertCircle
      : CheckCircle2;

  return (
    <article
      data-status={a.status}
      data-tone={statusTone}
      className={`client-reservation rounded-2xl border p-4 ${featured ? "client-reservation-featured shadow-premium" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {featured && <><p className="text-2xl font-semibold">{relativeDate ? `${relativeDate}, ` : ""}{formatInTimeZone(start, timezone, "HH:mm")}</p><p className="mb-3 mt-1 text-sm capitalize text-muted-foreground">{formatInTimeZone(start, timezone, "EEEE, d 'de' MMMM", { locale: ptBR })}</p></>}
          <p className="font-medium">{serviceName}</p>
          {a.dependentName && <p className="text-sm font-semibold">Atendimento para {a.dependentName}</p>}
          <p className="text-xs text-muted-foreground">com {a.professional.user.name}</p>
        </div>
        <span className="client-reservation-status inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold">
          <StatusIcon aria-hidden="true" className="h-3 w-3" />
          {statusLabel}
        </span>
      </div>
      <div className="client-reservation-details mt-4 rounded-xl p-3">
        {!featured && <><p className="text-lg font-semibold capitalize">
          {relativeDate ? `${relativeDate}, ` : ""}{formatInTimeZone(start, timezone, "HH:mm")}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
          {formatInTimeZone(start, timezone, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </p></>}
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
          {durationMinutes} min · {salonName}
        </p>
        {featured && <SalonLocationLink address={salonAddress} className="mt-1 text-xs leading-relaxed" />}
      </div>
      <VariablePriceNotice services={a.serviceItems} />
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
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="client-reservation-total text-sm font-semibold">
          {variablePrice ? "Valor inicial: " : "Total "}{formatMoney(total, currency)}
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
    RESCHEDULE_REQUESTED: "Alteração de horário aguardando sua resposta",
    RESCHEDULE_REJECTED: "Alteração de horário recusada",
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
