"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Scissors,
  Star,
  Zap,
} from "lucide-react";
import { formatMoney, formatDuration } from "@/lib/utils";
import { useCart } from "@/lib/cart";
import type { ClientSession } from "@/lib/client-auth";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

type Pro = {
  id: string;
  name: string;
  avatarUrl: string | null;
  colorHex: string | null;
  specialties: string[];
  apptCount: number;
  topPro: boolean;
};
type Service = {
  id: string;
  name: string;
  priceCents: number;
  durationMin: number;
  colorHex: string | null;
  professionals: Pro[];
};

/** Reserva confirmada — dados congelados para o boarding pass e o .ics */
type Booked = {
  startAt: Date;
  serviceName: string;
  durationMin: number;
  proName: string;
};

export function BookingFlow({
  salonId,
  salonName,
  currency,
  services,
  initialServiceId,
  clientSession,
}: {
  salonId: string;
  salonName: string;
  currency: string;
  services: Service[];
  initialServiceId: string | null;
  clientSession: ClientSession | null;
}) {
  const router = useRouter();
  const { salonSlug } = useParams<{ salonSlug: string }>();
  const cart = useCart(salonSlug);
  const [serviceId, setServiceId] = useState<string | null>(initialServiceId);
  const [proId, setProId] = useState<string | null>(null);
  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(new Date()));
  const [slot, setSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [popularSlot, setPopularSlot] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [name, setName] = useState(clientSession?.name ?? "");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [error, setError] = useState<string | null>(null);

  const service = services.find((s) => s.id === serviceId) ?? null;

  // Disponibilidade real: working hours + time-offs + agendamentos existentes
  useEffect(() => {
    if (!service || !proId) {
      setSlots([]);
      setPopularSlot(null);
      return;
    }
    const controller = new AbortController();
    setSlotsLoading(true);
    setSlot(null);
    const params = new URLSearchParams({
      salonId,
      professionalId: proId,
      serviceId: service.id,
      date: format(date, "yyyy-MM-dd"),
    });
    fetch(`/api/availability?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((b) => {
        setSlots(Array.isArray(b.slots) ? b.slots : []);
        setPopularSlot(typeof b.popularSlot === "string" ? b.popularSlot : null);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setSlots([]);
      })
      .finally(() => setSlotsLoading(false));
    return () => controller.abort();
  }, [salonId, service, proId, date]);

  const calendarDays = useMemo(() => {
    const first = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const last = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: first, end: last });
  }, [viewMonth]);

  async function submit() {
    if (!service || !proId || !slot) return;
    setLoading(true);
    setError(null);
    const [h, m] = slot.split(":").map(Number);
    const startAt = new Date(date);
    startAt.setHours(h, m, 0, 0);

    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        salonId,
        serviceId: service.id,
        professionalId: proId,
        startAt: startAt.toISOString(),
        ...(clientSession
          ? { clientId: clientSession.clientId }
          : { clientName: name, clientPhone: phone }),
        cartItems: cart.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      }),
    });
    setLoading(false);
    if (res.ok) {
      if (!clientSession && phone) {
        localStorage.setItem(`salon-phone:${salonSlug}`, phone);
      }
      const pro = service.professionals.find((p) => p.id === proId);
      cart.clear();
      setBooked({
        startAt,
        serviceName: service.name,
        durationMin: service.durationMin,
        proName: pro?.name ?? "",
      });
    } else {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Não foi possível concluir");
    }
  }

  if (booked) {
    return (
      <BoardingPass
        booked={booked}
        salonName={salonName}
        salonSlug={salonSlug}
      />
    );
  }

  // Se ainda não escolheu serviço, mostra seletor no mesmo formato dark
  if (!service) {
    return (
      <section className="animate-fade-in space-y-6 px-5 pt-6">
        <FlowHeader title="Escolha o serviço" onBack={() => router.push(`/book/${salonSlug}`)} />
        <div className="space-y-3">
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => setServiceId(s.id)}
              className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary"
            >
              <div className="flex items-center gap-3">
                <div
                  className="grid h-11 w-11 place-items-center rounded-xl"
                  style={{ background: `${s.colorHex ?? "#7DF89B"}33` }}
                >
                  <Scissors className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(s.durationMin)}
                  </p>
                </div>
              </div>
              <p className="text-sm font-semibold text-primary">
                {formatMoney(s.priceCents, currency)}
              </p>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="animate-fade-in space-y-8 px-5 pt-6">
      <FlowHeader
        title="Agendamento"
        onBack={() => setServiceId(null)}
        subtitle={`${service.name} · ${formatDuration(service.durationMin)}`}
      />

      {/* Escolher profissional — cards com prova social real */}
      <div>
        <h3 className="mb-4 text-sm font-semibold">Escolher profissional</h3>
        {service.professionals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum profissional realiza esse serviço ainda.
          </p>
        ) : (
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {service.professionals.map((p) => {
              const selected = p.id === proId;
              const specialty = p.specialties.find((s) => s !== service.name) ?? p.specialties[0];
              return (
                <button
                  key={p.id}
                  onClick={() => setProId(p.id)}
                  className={`flex w-[132px] shrink-0 flex-col items-center gap-2.5 rounded-3xl border p-4 transition duration-200 ${
                    selected
                      ? "scale-[1.03] border-primary bg-primary/10 ring-2 ring-primary"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="relative">
                    {p.avatarUrl ? (
                      <Image
                        src={p.avatarUrl}
                        alt={p.name}
                        width={56}
                        height={56}
                        className="h-14 w-14 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="grid h-14 w-14 place-items-center rounded-full text-base font-semibold"
                        style={{ background: p.colorHex ?? "#7DF89B", color: "#0E0F11" }}
                      >
                        {p.name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")}
                      </div>
                    )}
                    {p.topPro && (
                      <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow">
                        <Star className="h-3.5 w-3.5 fill-current" />
                      </span>
                    )}
                  </div>
                  <div className="text-center">
                    <p className={`text-sm font-semibold ${selected ? "text-foreground" : ""}`}>
                      {p.name.split(" ")[0]}
                    </p>
                    {specialty && (
                      <p className="mt-0.5 line-clamp-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {specialty}
                      </p>
                    )}
                  </div>
                  {p.topPro ? (
                    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
                      Mais pedido
                    </span>
                  ) : p.apptCount > 0 ? (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      +{p.apptCount} atendimentos
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Novo no time
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Data e hora */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Data e hora</h3>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-medium">
              <span className="text-muted-foreground">{format(viewMonth, "yyyy")}</span>{" "}
              <span className="text-primary">
                {format(viewMonth, "MMMM", { locale: ptBR })}
              </span>
            </p>
            <button
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
            {["S", "T", "Q", "Q", "S", "S", "D"].map((d, i) => (
              <span key={i} className="py-1">{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((d) => {
              const inMonth = isSameMonth(d, viewMonth);
              const past = isBefore(d, startOfDay(new Date()));
              const selected = isSameDay(d, date);
              const disabled = past || !inMonth;
              return (
                <button
                  key={d.toISOString()}
                  disabled={disabled}
                  onClick={() => setDate(d)}
                  className={`grid h-10 place-items-center rounded-full text-sm transition ${
                    selected
                      ? "bg-primary font-semibold text-primary-foreground"
                      : disabled
                        ? "text-muted-foreground/30"
                        : "text-foreground hover:bg-muted"
                  }`}
                >
                  {format(d, "d")}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Horários — disponibilidade real do profissional */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Horário disponível</h3>
          {!slotsLoading && slots.length > 0 && slots.length <= 6 && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
              <Zap className="h-3 w-3 fill-current" />
              Últimos horários do dia
            </span>
          )}
        </div>

        {!proId ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Escolha um profissional para ver os horários.
          </p>
        ) : slotsLoading ? (
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
        ) : slots.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Sem horários livres neste dia. Tente outra data.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {slots.map((s) => {
              const selected = s === slot;
              const popular = s === popularSlot;
              return (
                <button
                  key={s}
                  onClick={() => setSlot(s)}
                  className={`relative rounded-full border py-2 text-sm transition ${
                    selected
                      ? "border-primary bg-primary font-semibold text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-primary/50"
                  }`}
                >
                  {s}
                  {popular && !selected && (
                    <span
                      title="Horário concorrido"
                      className="absolute -right-1 -top-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-amber-400 text-black"
                    >
                      <Zap className="h-3 w-3 fill-current" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {popularSlot && slots.includes(popularSlot) && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3 fill-current text-amber-400" />
            {popularSlot} é o horário mais pedido — costuma esgotar primeiro.
          </p>
        )}
      </div>

      {/* Dados do cliente — collapsed até horário escolhido */}
      {slot && (
        <div className="rounded-2xl border border-border bg-card p-4">
          {clientSession ? (
            /* Logged-in: show identity, no form needed */
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
                {clientSession.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
              </div>
              <div>
                <p className="text-sm font-medium">{clientSession.name}</p>
                <p className="text-xs text-muted-foreground">{clientSession.email}</p>
              </div>
            </div>
          ) : (
            /* Guest: name + phone form */
            <div className="space-y-3">
              <p className="text-sm font-semibold">Seus dados</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="WhatsApp"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <p className="text-xs text-muted-foreground">
                Tem conta?{" "}
                <a href={`/book/${salonSlug}/login`} className="text-primary hover:underline">
                  Entre para agendar sem digitar seus dados
                </a>
              </p>
            </div>
          )}
        </div>
      )}

      {cart.items.length > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
          <span className="font-medium">
            🛒 {cart.count} {cart.count === 1 ? "produto" : "produtos"} do carrinho
          </span>
          <span className="font-semibold text-primary">
            +{formatMoney(cart.totalCents)}
          </span>
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-destructive/20 px-4 py-3 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      <button
        onClick={submit}
        disabled={!proId || !slot || (!clientSession && (!name || !phone)) || loading}
        className="mb-6 w-full rounded-full bg-primary py-4 text-base font-semibold text-primary-foreground shadow-lg transition disabled:opacity-40"
      >
        {loading ? "Confirmando…" : "Confirmar agendamento"}
      </button>
    </section>
  );
}

/**
 * Confirmação estilo boarding pass: o cartão que o cliente tira screenshot.
 * Linha perfurada separa o "canhoto"; botão gera .ics na hora (sem servidor).
 */
function BoardingPass({
  booked,
  salonName,
  salonSlug,
}: {
  booked: Booked;
  salonName: string;
  salonSlug: string;
}) {
  function downloadIcs() {
    const dt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");
    const end = new Date(booked.startAt.getTime() + booked.durationMin * 60_000);
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Trimly//Agendamento//PT",
      "BEGIN:VEVENT",
      `UID:${Date.now()}@trimly`,
      `DTSTAMP:${dt(new Date())}`,
      `DTSTART:${dt(booked.startAt)}`,
      `DTEND:${dt(end)}`,
      `SUMMARY:${booked.serviceName} — ${salonName}`,
      `DESCRIPTION:Com ${booked.proName}. Reserva feita pelo Trimly.`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agendamento.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="mb-6 grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_40px_-8px_hsl(var(--primary))]">
        <Check className="h-8 w-8" strokeWidth={2.5} />
      </div>
      <h1 className="font-display text-2xl">Reserva confirmada</h1>
      <p className="mt-1 text-sm text-muted-foreground">Te esperamos lá 👇</p>

      {/* Cartão */}
      <div className="relative mt-8 w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card">
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {salonName}
            </p>
            <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Confirmado
            </span>
          </div>
          <div>
            <p className="font-display text-4xl leading-none text-primary">
              {format(booked.startAt, "HH:mm")}
            </p>
            <p className="mt-2 text-sm capitalize text-foreground">
              {format(booked.startAt, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
        </div>

        {/* Perfuração */}
        <div className="relative flex items-center">
          <span className="absolute -left-3 h-6 w-6 rounded-full bg-background" />
          <span className="mx-5 flex-1 border-t-2 border-dashed border-border" />
          <span className="absolute -right-3 h-6 w-6 rounded-full bg-background" />
        </div>

        <div className="grid grid-cols-2 gap-4 p-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Serviço
            </p>
            <p className="mt-1 text-sm font-medium">{booked.serviceName}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Profissional
            </p>
            <p className="mt-1 text-sm font-medium">{booked.proName}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Duração
            </p>
            <p className="mt-1 text-sm font-medium">{formatDuration(booked.durationMin)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Lembrete
            </p>
            <p className="mt-1 text-sm font-medium">No dia, via WhatsApp</p>
          </div>
        </div>
      </div>

      <div className="mt-8 flex w-full max-w-sm flex-col gap-2">
        <button
          onClick={downloadIcs}
          className="flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground"
        >
          <CalendarPlus className="h-4 w-4" />
          Adicionar ao calendário
        </button>
        <Link
          href={`/book/${salonSlug}/minhas`}
          className="rounded-full border border-border bg-card px-6 py-3.5 text-center text-sm font-medium"
        >
          Ver minhas reservas
        </Link>
        <Link
          href={`/book/${salonSlug}`}
          className="py-2 text-center text-sm text-muted-foreground"
        >
          Voltar para o início
        </Link>
      </div>
    </div>
  );
}

function FlowHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
}) {
  return (
    <header className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-foreground"
        aria-label="Voltar"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="flex-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </header>
  );
}
