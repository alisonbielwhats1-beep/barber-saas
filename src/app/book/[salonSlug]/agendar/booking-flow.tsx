"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Scissors } from "lucide-react";
import { formatMoney, formatDuration } from "@/lib/utils";
import { useCart } from "@/lib/cart";
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

type Pro = { id: string; name: string; colorHex: string | null };
type Service = {
  id: string;
  name: string;
  priceCents: number;
  durationMin: number;
  colorHex: string | null;
  professionals: Pro[];
};

export function BookingFlow({
  salonId,
  salonName,
  currency,
  services,
  initialServiceId,
}: {
  salonId: string;
  salonName: string;
  currency: string;
  services: Service[];
  initialServiceId: string | null;
}) {
  const router = useRouter();
  const { salonSlug } = useParams<{ salonSlug: string }>();
  const cart = useCart(salonSlug);
  const [serviceId, setServiceId] = useState<string | null>(initialServiceId);
  const [proId, setProId] = useState<string | null>(null);
  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(new Date()));
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = services.find((s) => s.id === serviceId) ?? null;

  // Slots mock 15em15 das 09:00 às 19:00 — sub por chamada /api/availability
  // quando quiser respeitar bookings existentes.
  const slots = useMemo(() => {
    const list: string[] = [];
    for (let h = 9; h < 19; h++) {
      list.push(`${h.toString().padStart(2, "0")}:00`);
      list.push(`${h.toString().padStart(2, "0")}:30`);
    }
    return list;
  }, []);

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
        clientName: name,
        clientPhone: phone,
        cartItems: cart.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      }),
    });
    setLoading(false);
    if (res.ok) {
      // Guarda phone pra tela Minhas identificar
      localStorage.setItem(`salon-phone:${salonSlug}`, phone);
      cart.clear();
      setDone(true);
    } else {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Não foi possível concluir");
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-8 text-center">
        <div className="mb-6 grid h-20 w-20 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-10 w-10" strokeWidth={2.5} />
        </div>
        <h1 className="font-display text-3xl">Tudo certo!</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Sua reserva em <span className="text-foreground">{salonName}</span> foi
          confirmada. Enviaremos um lembrete no dia.
        </p>
        <div className="mt-8 flex flex-col gap-2 w-full max-w-xs">
          <Link
            href={`/book/${salonSlug}/minhas`}
            className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
          >
            Ver minhas reservas
          </Link>
          <Link
            href={`/book/${salonSlug}`}
            className="text-sm text-muted-foreground"
          >
            Voltar para o início
          </Link>
        </div>
      </div>
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

      {/* Escolher profissional */}
      <div>
        <h3 className="mb-4 text-sm font-semibold">Escolher profissional</h3>
        {service.professionals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum profissional realiza esse serviço ainda.
          </p>
        ) : (
          <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {service.professionals.map((p) => {
              const selected = p.id === proId;
              return (
                <button
                  key={p.id}
                  onClick={() => setProId(p.id)}
                  className="flex shrink-0 flex-col items-center gap-2"
                  style={{ width: 72 }}
                >
                  <div
                    className={`grid h-16 w-16 place-items-center rounded-full text-lg font-semibold transition ${
                      selected
                        ? "ring-2 ring-primary ring-offset-4 ring-offset-background"
                        : ""
                    }`}
                    style={{
                      background: p.colorHex ?? "#7DF89B",
                      color: "#0E0F11",
                    }}
                  >
                    {p.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <span className={`text-xs ${selected ? "text-foreground" : "text-muted-foreground"}`}>
                    {p.name.split(" ")[0]}
                  </span>
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
                  onClick={() => {
                    setDate(d);
                    setSlot(null);
                  }}
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

      {/* Horários */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Horário disponível</h3>
        <div className="grid grid-cols-4 gap-2">
          {slots.map((s) => {
            const selected = s === slot;
            return (
              <button
                key={s}
                onClick={() => setSlot(s)}
                className={`rounded-full border py-2 text-sm transition ${
                  selected
                    ? "border-primary bg-primary font-semibold text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary/50"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dados do cliente — collapsed até horário escolhido */}
      {slot && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
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
        disabled={!proId || !slot || !name || !phone || loading}
        className="mb-6 w-full rounded-full bg-primary py-4 text-base font-semibold text-primary-foreground shadow-lg transition disabled:opacity-40"
      >
        {loading ? "Confirmando…" : "Enviar reserva"}
      </button>
    </section>
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
