"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { VisitChoice, VisitPlan, VisitService } from "@/lib/visit-plan";
import { VisitSummary } from "@/components/visit-summary";
import { useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/utils";
import { addCalendarDays } from "@/lib/time";
import { DependentPicker } from "./dependent-picker";

type Quote = VisitPlan & { quote: string };
const field =
  "min-h-11 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-base";
const primary =
  "min-h-12 w-full rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-40";
export function VisitBooking({
  salonId,
  salonSlug,
  salonName,
  services,
  serviceIds,
  simultaneousPairs = [],
  today,
  maxDate,
  currency,
  authenticated,
  cancelPolicyHours,
  onBack,
}: {
  salonId: string;
  salonSlug: string;
  salonName: string;
  services: VisitService[];
  serviceIds: string[];
  simultaneousPairs?: [string, string][];
  today: string;
  maxDate: string;
  currency: string;
  authenticated: boolean;
  cancelPolicyHours: number;
  onBack: () => void;
}) {
  const router = useRouter(),
    cart = useCart(salonSlug);
  const [choices, setChoices] = useState<VisitChoice[]>(() =>
    serviceIds.map((id) => {
      const pros = services.find((s) => s.id === id)?.professionals ?? [];
      return {
        serviceId: id,
        ...(pros.length === 1 ? { professionalId: pros[0]!.id } : {}),
      };
    }),
  );
  const [date, setDate] = useState(today),
    [plans, setPlans] = useState<Quote[]>([]),
    [selected, setSelected] = useState<Quote | null>(null),
    [review, setReview] = useState(false),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [dependentId, setDependentId] = useState("");
  const request = useRef(0),
    key = useRef<string | null>(null),
    sending = useRef(false),
    restore = useRef<string | null>(null),
    cooldown = useRef(0);
  const storageKey = `visit-selection:${salonSlug}`;
  useEffect(() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (
        raw &&
        Date.now() - raw.savedAt < 1800000 &&
        JSON.stringify(raw.choices?.map((c: VisitChoice) => c.serviceId)) ===
          JSON.stringify(serviceIds) &&
        raw.date >= today &&
        raw.date <= maxDate
      ) {
        setChoices(raw.choices);
        setDate(raw.date);
        restore.current = raw.startLocal ?? null;
      }
    } catch {
      /* Optional storage. */
    }
    setReady(true);
  }, [storageKey, serviceIds, today, maxDate]);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          choices,
          date,
          startLocal: selected?.startLocal,
          savedAt: Date.now(),
        }),
      );
    } catch {
      /* No identity is persisted. */
    }
  }, [choices, date, selected, ready, storageKey]);
  const queryKey = JSON.stringify({ salonId, date, choices });
  useEffect(() => {
    if (done) return;
    const n = ++request.current;
    const abort = new AbortController();
    setSelected(null);
    setPlans([]);
    setReview(false);
    key.current = null;
    if (!ready || done) return;
    if (Date.now() < cooldown.current) {
      setLoading(false);
      setError("Aguarde um minuto e toque em Consultar novamente.");
      return;
    }
    setLoading(true);
    setError("");
    fetch("/api/visits/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: queryKey,
      signal: abort.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (n !== request.current) return;
        if (res.status === 429) {
          const header = res.headers.get("Retry-After");
          const seconds = Number(header);
          cooldown.current =
            Date.now() +
            (header && Number.isFinite(seconds)
              ? Math.max(1, seconds) * 1000
              : 60000);
        }
        if (!res.ok)
          throw new Error(body.error ?? "Falha ao consultar horários.");
        if (!Array.isArray(body.plans))
          throw new Error("Resposta inválida. Consulte novamente.");
        setPlans(body.plans);
        if (restore.current) {
          setSelected(
            body.plans.find((p: Quote) => p.startLocal === restore.current) ??
              null,
          );
          restore.current = null;
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted && n === request.current)
          setError(
            e instanceof Error ? e.message : "Falha ao consultar horários.",
          );
      })
      .finally(() => {
        if (n === request.current) setLoading(false);
      });
    return () => {
      abort.abort();
      // Each request captures n; invalidating it also protects mocked or
      // already-resolved fetches that cannot be cancelled by AbortController.
      request.current = n + 1;
    };
  }, [queryKey, ready, reload, done]);
  function changeChoice(index: number, value: string) {
    setChoices((items) =>
      items.map((item, i) =>
        i === index ? { ...item, professionalId: value || undefined } : item,
      ),
    );
  }
  async function confirm() {
    if (!selected || sending.current) return;
    if (!authenticated) {
      const returnTo = `/book/${salonSlug}/agendar?services=${encodeURIComponent(serviceIds.join(","))}`;
      router.push(
        `/book/${salonSlug}/welcome?returnTo=${encodeURIComponent(returnTo)}`,
      );
      return;
    }
    sending.current = true;
    setSaving(true);
    setError("");
    key.current ??= crypto.randomUUID();
    try {
      const startMinute =
        Number(selected.startLocal.slice(11, 13)) * 60 +
        Number(selected.startLocal.slice(14, 16));
      const concrete = selected.items.map((item) => ({
        serviceId: item.serviceId,
        professionalId: item.professionalId,
        offsetMin:
          Number(item.startLocal.slice(11, 13)) * 60 +
          Number(item.startLocal.slice(14, 16)) -
          startMinute,
      }));
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId,
          date,
          choices: concrete,
          startLocal: selected.startLocal,
          idempotencyKey: key.current,
          quote: selected.quote,
          ...(dependentId ? { dependentId } : {}),
          cartItems: cart.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
          expectedProductTotalCents: cart.totalCents,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          router.push(
            `/book/${salonSlug}/welcome?returnTo=${encodeURIComponent(`/book/${salonSlug}/agendar?services=${serviceIds.join(",")}`)}`,
          );
          return;
        }
        if (res.status === 409) {
          setReview(false);
          setSelected(null);
        }
        throw new Error(body.error ?? "Não foi possível confirmar a visita.");
      }
      setDone(true);
      cart.clear();
      try {
        sessionStorage.removeItem(storageKey);
        sessionStorage.removeItem(`booking-state:${salonSlug}`);
      } catch {
        /* Optional storage. */
      }
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Confira sua conexão e tente novamente.",
      );
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }
  if (done && selected)
    return (
      <section className="space-y-5 px-5 py-6">
        <h1 className="text-2xl font-semibold">Visita confirmada</h1>
        <p className="text-sm text-muted-foreground">
          Todos os serviços estão reservados em {salonName}.
        </p>
        <VisitSummary plan={selected} currency={currency} />
        <Link
          href={`/book/${salonSlug}/minhas`}
          className={`${primary} block text-center`}
        >
          Ver minha visita
        </Link>
      </section>
    );
  return (
    <section className="space-y-5 px-5 pb-32 pt-6">
      <fieldset disabled={saving} className="min-w-0 space-y-5">
        <button
          type="button"
          className="min-h-11 text-sm font-medium text-primary"
          onClick={() => (review ? setReview(false) : onBack())}
        >
          ← {review ? "Voltar aos horários" : "Alterar serviços"}
        </button>
        <div>
          <p className="text-xs text-muted-foreground">{salonName}</p>
          <h1 className="mt-1 text-2xl font-semibold">
            {review ? "Revisar minha visita" : "Todos os serviços, uma visita"}
          </h1>
        </div>
        {!review && (
          <>
            <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
              {choices.map((choice, i) => {
                const service = services.find(
                  (s) => s.id === choice.serviceId,
                )!;
                return (
                  <div key={i} className="space-y-2 py-4">
                    <p className="text-sm font-semibold">{service.name}</p>
                    {service.professionals.length === 1 ? (
                      <p className="text-sm text-muted-foreground">
                        com {service.professionals[0]!.name} ·{" "}
                        {service.durationMin} min
                      </p>
                    ) : (
                      <label className="grid gap-2 text-sm">
                        Profissional para {service.name}
                        <select
                          className={field}
                          value={choice.professionalId ?? ""}
                          onChange={(e) => changeChoice(i, e.target.value)}
                        >
                          <option value="">Sem preferência</option>
                          {service.professionals.map((pro) => (
                            <option key={pro.id} value={pro.id}>
                              {pro.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {i > 0 &&
                      (choice.offsetMin === 0 ||
                        simultaneousPairs.some(
                          (pair) =>
                            pair.includes(choice.serviceId) &&
                            pair.includes(choices[0]!.serviceId),
                        )) && (
                        <label className="grid gap-2 text-sm">
                          Quando fazer este serviço?
                          <select
                            className={field}
                            value={
                              choice.offsetMin === 0 ? "together" : "after"
                            }
                            onChange={(e) =>
                              setChoices((items) =>
                                items.map((c, j) =>
                                  j === i
                                    ? {
                                        ...c,
                                        offsetMin:
                                          e.target.value === "together"
                                            ? 0
                                            : undefined,
                                      }
                                    : c,
                                ),
                              )
                            }
                          >
                            <option value="after">
                              Depois do serviço anterior
                            </option>
                            <option value="together">
                              Junto com o primeiro serviço
                            </option>
                          </select>
                        </label>
                      )}
                  </div>
                );
              })}
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Dia da visita
              <input
                className={field}
                type="date"
                min={today}
                max={maxDate}
                value={date}
                onChange={(e) => {
                  if (e.target.value >= today && e.target.value <= maxDate)
                    setDate(e.target.value);
                }}
              />
            </label>
            <div aria-live="polite">
              {loading ? (
                <p className="text-sm">
                  Procurando horários para todos os serviços…
                </p>
              ) : plans.length ? (
                <>
                  <h2 className="mb-3 font-semibold">
                    Horários para a visita completa
                  </h2>
                  <div className="grid grid-cols-3 gap-2">
                    {plans.map((plan) => (
                      <button
                        type="button"
                        key={plan.startLocal}
                        aria-pressed={selected?.startLocal === plan.startLocal}
                        onClick={() => {
                          key.current = null;
                          setSelected(plan);
                        }}
                        className={`min-h-12 rounded-xl border p-2 text-sm ${selected?.startLocal === plan.startLocal ? "border-primary bg-primary/10 text-primary" : "border-border bg-card"}`}
                      >
                        {plan.startLocal.slice(11, 16)}
                        <span className="block text-xs text-muted-foreground">
                          até {plan.endLocal.slice(11, 16)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                !error && (
                  <div className="space-y-3 rounded-xl border border-border p-4">
                    <p className="text-sm">
                      Não encontramos horários para a visita completa neste dia.
                      Tente outra data, outro profissional ou faça os serviços
                      em sequência.
                    </p>
                    {date < maxDate && (
                      <button
                        type="button"
                        className={field}
                        onClick={() => setDate(addCalendarDays(date, 1))}
                      >
                        Consultar o dia seguinte
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
          </>
        )}
        {selected && <VisitSummary plan={selected} currency={currency} />}
        {review && (
          <>
            <p className="text-sm">
              Data: {date.split("-").reverse().join("/")} · {salonName}
            </p>
            <p className="text-sm text-muted-foreground">
              Alterações pelo aplicativo até {cancelPolicyHours}h antes de cada
              atendimento. Cada serviço pode ser alterado individualmente em
              Minhas reservas.
            </p>
            {authenticated && (
              <DependentPicker
                salonId={salonId}
                value={dependentId}
                onChange={(value) => {
                  key.current = null;
                  setDependentId(value);
                }}
              />
            )}
            {cart.items.length > 0 && (
              <p className="text-sm">
                Produtos do carrinho: {formatMoney(cart.totalCents, currency)} ·
                Total com produtos:{" "}
                {formatMoney(
                  (selected?.totalCents ?? 0) + cart.totalCents,
                  currency,
                )}
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!review && (
          <button
            type="button"
            className="min-h-11 text-sm text-primary"
            disabled={loading}
            onClick={() => setReload((n) => n + 1)}
          >
            Consultar novamente
          </button>
        )}
        <button
          type="button"
          className={primary}
          disabled={!selected || loading || saving}
          onClick={() => (review ? void confirm() : setReview(true))}
        >
          {saving
            ? "Confirmando todos os serviços…"
            : review
              ? authenticated
                ? "Confirmar visita"
                : "Entrar para confirmar visita"
              : "Revisar minha visita"}
        </button>
      </fieldset>
    </section>
  );
}
