"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, User, MapPin, XCircle } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { format, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";

type Appt = {
  id: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  status: string;
  service: { name: string; colorHex: string | null };
  professional: { user: { name: string } };
  products: { quantity: number; priceCentsUnit: number; product: { name: string } }[];
};

const PHONE_KEY = (slug: string) => `salon-phone:${slug}`;

export function MinhasList({ salonSlug }: { salonSlug: string }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [inputPhone, setInputPhone] = useState("");
  const [data, setData] = useState<{ appointments: Appt[]; client?: { name: string }; currency?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const stored = localStorage.getItem(PHONE_KEY(salonSlug));
    if (stored) setPhone(stored);
  }, [salonSlug]);

  useEffect(() => {
    if (!phone) return;
    setLoading(true);
    fetch(`/api/client/appointments?salon=${salonSlug}&phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [phone, salonSlug]);

  function connect() {
    const p = inputPhone.trim();
    if (!p) return;
    localStorage.setItem(PHONE_KEY(salonSlug), p);
    setPhone(p);
  }

  function disconnect() {
    localStorage.removeItem(PHONE_KEY(salonSlug));
    setPhone(null);
    setData(null);
  }

  function cancel(id: string) {
    if (!phone || !confirm("Cancelar essa reserva?")) return;
    startTransition(async () => {
      await fetch("/api/client/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonSlug, phone, appointmentId: id }),
      });
      // Recarrega
      const r = await fetch(
        `/api/client/appointments?salon=${salonSlug}&phone=${encodeURIComponent(phone)}`,
      );
      setData(await r.json());
    });
  }

  if (!phone) {
    return (
      <div className="space-y-3 rounded-2xl border border-border bg-card p-6">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
          <User className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">Ver minhas reservas</p>
        <p className="text-xs text-muted-foreground">
          Digite o telefone que você usou ao agendar.
        </p>
        <input
          value={inputPhone}
          onChange={(e) => setInputPhone(e.target.value)}
          placeholder="(11) 91234-5678"
          className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
        />
        <button
          onClick={connect}
          disabled={!inputPhone.trim()}
          className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          Continuar
        </button>
        <Link
          href={`/book/${salonSlug}/agendar`}
          className="block text-center text-xs text-primary"
        >
          Ainda não agendou? Faça agora →
        </Link>
      </div>
    );
  }

  if (loading || !data) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  const upcoming = data.appointments.filter(
    (a) => !isPast(new Date(a.endAt)) && a.status !== "CANCELLED",
  );
  const past = data.appointments.filter(
    (a) => isPast(new Date(a.endAt)) || a.status === "CANCELLED",
  );

  return (
    <>
      {data.client && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <span className="font-medium">Olá, {data.client.name}</span>
          </div>
          <button
            onClick={disconnect}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Trocar
          </button>
        </div>
      )}

      <Section title="Próximas" empty="Nenhuma reserva futura.">
        {upcoming.map((a) => (
          <ApptCard key={a.id} a={a} canCancel onCancel={() => cancel(a.id)} disabled={pending} />
        ))}
      </Section>

      <Section title="Histórico" empty="Sem histórico ainda.">
        {past.map((a) => (
          <ApptCard key={a.id} a={a} />
        ))}
      </Section>
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
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
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
  canCancel,
  onCancel,
  disabled,
}: {
  a: Appt;
  canCancel?: boolean;
  onCancel?: () => void;
  disabled?: boolean;
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
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            a.status === "CANCELLED"
              ? "bg-destructive/10 text-destructive"
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
              <span>{formatMoney(p.quantity * p.priceCentsUnit)}</span>
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">
          Total {formatMoney(total)}
        </span>
        {canCancel && (
          <button
            onClick={onCancel}
            disabled={disabled}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-40"
          >
            <XCircle className="h-3.5 w-3.5" /> Cancelar
          </button>
        )}
      </div>
    </article>
  );
}
