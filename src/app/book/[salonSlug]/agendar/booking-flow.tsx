"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Gem,
  LogIn,
  Search,
  Scissors,
  Sparkles,
  Star,
  UserPlus,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { formatMoney, formatDuration } from "@/lib/utils";
import { useCart } from "@/lib/cart";
import { formatPhoneBR, isValidPhoneBR, normalizePhone } from "@/lib/phone";
import { friendlyError } from "@/lib/booking-errors";
import type { ClientSession } from "@/lib/client-auth";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  filterServiceOptions,
  getServiceCategories,
  serviceCategoryLabel,
} from "@/lib/service-discovery";

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
  description: string | null;
  priceCents: number;
  durationMin: number;
  colorHex: string | null;
  category: string | null;
  professionals: Pro[];
};

/** Ícone do serviço por categoria — evita a tesoura fixa para todo segmento. */
function iconForService(category: string | null) {
  const n = (category ?? "").toLowerCase();
  if (n.includes("unha")) return Gem;
  if (n.includes("massagem") || n.includes("pele") || n.includes("depila") || n.includes("estetic"))
    return Waves;
  if (n.includes("maquiagem") || n.includes("sobrancelha")) return Sparkles;
  return Scissors;
}

/** Reserva confirmada — dados congelados para o boarding pass e o .ics */
type Booked = {
  startAt: Date;
  timezone: string;
  serviceName: string;
  durationMin: number;
  proName: string;
};

export function BookingFlow({
  salonId,
  salonName,
  currency,
  timezone,
  todayDate,
  services,
  initialServiceIds,
  initialProId = null,
  rescheduleId = null,
  rescheduleVersion,
  clientSession,
}: {
  salonId: string;
  salonName: string;
  currency: string;
  timezone: string;
  todayDate: string;
  services: Service[];
  initialServiceIds: string[];
  initialProId?: string | null;
  /** Se vier de "Minhas reservas → Remarcar": id da reserva a atualizar em
   *  vez de criar uma nova. Ver `submit()`. */
  rescheduleId?: string | null;
  rescheduleVersion?: number;
  clientSession: ClientSession | null;
}) {
  const router = useRouter();
  const { salonSlug } = useParams<{ salonSlug: string }>();
  const cart = useCart(salonSlug);
  const validInitialServiceIds = [
    ...new Set(
      initialServiceIds.filter((id) => services.some((service) => service.id === id)),
    ),
  ];
  const [serviceIds, setServiceIds] = useState<string[]>(validInitialServiceIds);
  const [choosingServices, setChoosingServices] = useState(validInitialServiceIds.length === 0);
  const [serviceQuery, setServiceQuery] = useState("");
  const [serviceCategory, setServiceCategory] = useState<string | null>(null);
  const [proId, setProId] = useState<string | null>(() => {
    if (!initialProId || validInitialServiceIds.length === 0) return null;
    const selected = services.filter((service) => validInitialServiceIds.includes(service.id));
    return selected.length === validInitialServiceIds.length &&
      selected.every((service) =>
        service.professionals.some((professional) => professional.id === initialProId),
      )
      ? initialProId
      : null;
  });
  const [date, setDate] = useState<Date>(() => new Date(`${todayDate}T12:00:00`));
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    startOfMonth(new Date(`${todayDate}T12:00:00`)),
  );
  const [slot, setSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsVersion, setSlotsVersion] = useState(0);
  const [popularSlot, setPopularSlot] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [occupied, setOccupied] = useState<{ appointmentId: string; time: string }[]>([]);
  const [waitlistTarget, setWaitlistTarget] = useState<{ appointmentId: string; time: string } | null>(null);
  const [waitlistName, setWaitlistName] = useState(clientSession?.name ?? "");
  const [waitlistPhone, setWaitlistPhone] = useState("");
  const [waitlistJoined, setWaitlistJoined] = useState<{
    appointmentId: string;
    position: number;
    time: string;
    serviceName: string;
    professionalName: string;
    dateLabel: string;
  } | null>(null);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [name, setName] = useState(clientSession?.name ?? "");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "hidden" → no auth prompt yet; "prompt" → show login/guest options; "guest-form" → collecting name+phone
  const [authStep, setAuthStep] = useState<"hidden" | "prompt" | "guest-form">("hidden");
  const idempotencyKeyRef = useRef<string | null>(null);

  const selectedServices = useMemo(
    () => services.filter((service) => serviceIds.includes(service.id)),
    [services, serviceIds],
  );
  const serviceCategories = useMemo(() => getServiceCategories(services), [services]);
  const visibleServices = useMemo(
    () => filterServiceOptions(services, serviceQuery, serviceCategory),
    [services, serviceQuery, serviceCategory],
  );
  const eligibleProfessionals = useMemo(() => {
    const first = selectedServices[0];
    if (!first) return [];
    return first.professionals.filter((professional) =>
      selectedServices.every((service) =>
        service.professionals.some((candidate) => candidate.id === professional.id),
      ),
    );
  }, [selectedServices]);
  const serviceName = selectedServices.map((service) => service.name).join(" + ");
  const totalDuration = selectedServices.reduce(
    (sum, service) => sum + service.durationMin,
    0,
  );
  const totalServicePrice = selectedServices.reduce(
    (sum, service) => sum + service.priceCents,
    0,
  );

  // Slot a restaurar depois que a grade de horários carregar (fluxo returnTo)
  const pendingSlotRef = useRef<string | null>(null);

  // Restaura a seleção salva antes de ir para login/cadastro — o cliente
  // volta exatamente onde parou (profissional, dia e horário escolhidos).
  useEffect(() => {
    try {
      // Remedia versões antigas que persistiam telefone de visitante.
      localStorage.removeItem(`salon-phone:${salonSlug}`);
      const key = `booking-state:${salonSlug}`;
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      sessionStorage.removeItem(key);
      const s = JSON.parse(raw) as {
        serviceId?: string;
        serviceIds?: string[];
        proId?: string;
        date?: string;
        slot?: string;
        savedAt?: number;
      };
      if (!s.savedAt || Date.now() - s.savedAt > 30 * 60_000) return;
      const restoredIds = s.serviceIds ?? (s.serviceId ? [s.serviceId] : []);
      const validIds = restoredIds.filter((id) =>
        services.some((service) => service.id === id),
      );
      if (validIds.length > 0) {
        setServiceIds([...new Set(validIds)]);
        setChoosingServices(false);
      }
      if (s.proId) setProId(s.proId);
      if (s.date) {
        const d = new Date(`${s.date}T12:00:00`);
        setDate(d);
        setViewMonth(startOfMonth(d));
      }
      if (s.slot) pendingSlotRef.current = s.slot;
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Congela a seleção atual antes de sair para login/cadastro. */
  function saveBookingState() {
    try {
      sessionStorage.setItem(
        `booking-state:${salonSlug}`,
        JSON.stringify({
          serviceIds,
          proId,
          date: format(date, "yyyy-MM-dd"),
          slot,
          savedAt: Date.now(),
        }),
      );
    } catch {}
  }

  const returnToParam = selectedServices.length > 0
    ? `?returnTo=${encodeURIComponent(`/book/${salonSlug}/agendar?services=${serviceIds.join(",")}`)}`
    : "";

  // Disponibilidade real: working hours + time-offs + agendamentos existentes
  useEffect(() => {
    if (selectedServices.length === 0 || !proId) {
      setSlots([]);
      setPopularSlot(null);
      setOccupied([]);
      return;
    }
    const controller = new AbortController();
    setSlotsLoading(true);
    setSlot(null);
    const params = new URLSearchParams({
      salonId,
      professionalId: proId,
      serviceId: serviceIds.join(","),
      date: format(date, "yyyy-MM-dd"),
    });
    fetch(`/api/availability?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((b) => {
        const list: string[] = Array.isArray(b.slots) ? b.slots : [];
        setSlots(list);
        setPopularSlot(typeof b.popularSlot === "string" ? b.popularSlot : null);
        setOccupied(Array.isArray(b.occupied) ? b.occupied : []);
        // Fluxo returnTo: re-seleciona o horário salvo se ainda estiver livre
        if (pendingSlotRef.current && list.includes(pendingSlotRef.current)) {
          setSlot(pendingSlotRef.current);
        }
        pendingSlotRef.current = null;
      })
      .catch((e) => {
        if (e.name !== "AbortError") setSlots([]);
      })
      .finally(() => setSlotsLoading(false));
    return () => controller.abort();
  }, [salonId, selectedServices, serviceIds, proId, date, slotsVersion]);

  // A mesma tentativa reutiliza a chave em caso de falha de rede. Alterar a
  // escolha cria uma nova tentativa lógica e, portanto, uma nova chave.
  useEffect(() => {
    idempotencyKeyRef.current = null;
  }, [serviceIds, proId, slot, date, rescheduleId]);

  const calendarDays = useMemo(() => {
    const first = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const last = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: first, end: last });
  }, [viewMonth]);

  function handleConfirmClick() {
    if (selectedServices.length === 0 || !proId || !slot) return;
    if (clientSession) {
      submit();
    } else if (authStep === "guest-form" && name && isValidPhoneBR(phone)) {
      submit();
    } else if (authStep === "guest-form") {
      // form visible but not filled
    } else {
      setAuthStep("prompt");
    }
  }

  async function submit() {
    if (selectedServices.length === 0 || !proId || !slot) return;
    setLoading(true);
    setError(null);
    const startLocal = `${format(date, "yyyy-MM-dd")}T${slot}`;
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;

    try {
      const res = rescheduleId
        ? await fetch("/api/client/reschedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              salonSlug,
              appointmentId: rescheduleId,
              professionalId: proId,
              startLocal,
              idempotencyKey,
              ...(Number.isInteger(rescheduleVersion)
                ? { expectedVersion: rescheduleVersion }
                : {}),
            }),
          })
        : await fetch("/api/appointments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              salonId,
              serviceIds,
              professionalId: proId,
              startLocal,
              idempotencyKey,
              ...(!clientSession
                ? { clientName: name, clientPhone: normalizePhone(phone) }
                : {}),
              cartItems: cart.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
            }),
          });
      const responseBody = await res.json().catch(() => ({}));
      if (res.ok) {
        const confirmedStart = new Date(responseBody.appointment?.startAt);
        if (Number.isNaN(confirmedStart.getTime())) {
          throw new Error("INVALID_SERVER_APPOINTMENT");
        }
        const pro = eligibleProfessionals.find((professional) => professional.id === proId);
        if (!rescheduleId) cart.clear();
        setBooked({
          startAt: confirmedStart,
          timezone,
          serviceName,
          durationMin: totalDuration,
          proName: pro?.name ?? "",
        });
      } else {
        setError(friendlyError(responseBody.error));
        if (responseBody.error === "SLOT_TAKEN") {
          idempotencyKeyRef.current = null;
          setSlot(null);
          setSlotsVersion((version) => version + 1);
        }
      }
    } catch {
      setError("Não foi possível confirmar agora. Verifique sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function joinWaitlist() {
    if (!waitlistTarget || !proId || serviceIds.length === 0) return;
    if (!clientSession && (!waitlistName || !isValidPhoneBR(waitlistPhone))) return;
    setWaitlistLoading(true);
    setWaitlistError(null);
    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId,
          appointmentId: waitlistTarget.appointmentId,
          professionalId: proId,
          serviceIds,
          ...(!clientSession
            ? { clientName: waitlistName, clientPhone: normalizePhone(waitlistPhone) }
            : {}),
        }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWaitlistError(friendlyError(responseBody.error));
        return;
      }
      const position = Number(responseBody.position);
      if (!Number.isInteger(position) || position < 1) {
        throw new Error("INVALID_WAITLIST_RESPONSE");
      }
      setWaitlistJoined({
        appointmentId: waitlistTarget.appointmentId,
        position,
        time: waitlistTarget.time,
        serviceName: Array.isArray(responseBody.serviceNames)
          ? responseBody.serviceNames.join(" + ")
          : serviceName,
        professionalName:
          eligibleProfessionals.find((professional) => professional.id === proId)?.name ?? "",
        dateLabel: responseBody.startAt && responseBody.timezone
          ? formatInTimeZone(
              new Date(responseBody.startAt),
              responseBody.timezone,
              "dd 'de' MMMM",
              { locale: ptBR },
            )
          : format(date, "dd 'de' MMMM", { locale: ptBR }),
      });
      setWaitlistTarget(null);
    } catch {
      setWaitlistError("Não foi possível entrar na fila agora. Verifique sua conexão e tente novamente.");
    } finally {
      setWaitlistLoading(false);
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

  // Seleção explícita permite combinar serviços antes do profissional.
  if (choosingServices) {
    return (
      <section className="animate-fade-in min-h-dvh space-y-6 px-5 pb-28 pt-6">
        <FlowHeader title="Escolha os serviços" onBack={() => router.push(`/book/${salonSlug}`)} />
        {selectedServices.length > 0 && (
          <div
            aria-live="polite"
            className="flex items-start justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary">
                {selectedServices.length} {selectedServices.length === 1 ? "serviço escolhido" : "serviços escolhidos"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {selectedServices.map((service) => service.name).join(" + ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setServiceIds([]);
                setProId(null);
                setSlot(null);
              }}
              className="min-h-11 shrink-0 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Limpar
            </button>
          </div>
        )}

        <div className="space-y-3">
          <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-card px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Buscar serviços</span>
            <input
              type="search"
              value={serviceQuery}
              onChange={(event) => {
                setServiceQuery(event.target.value);
                if (event.target.value) setServiceCategory(null);
              }}
              placeholder="Buscar corte, barba, manicure…"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            {serviceQuery && (
              <button
                type="button"
                onClick={() => setServiceQuery("")}
                aria-label="Limpar busca"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>

          {serviceCategories.length > 1 && (
            <div
              className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Filtrar por categoria"
            >
              {[null, ...serviceCategories].map((category) => {
                const active = serviceCategory === category;
                return (
                  <button
                    key={category ?? "all"}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setServiceCategory(category);
                      setServiceQuery("");
                    }}
                    className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground"
                    }`}
                  >
                    {category ?? "Todos"}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            {visibleServices.length} {visibleServices.length === 1 ? "serviço" : "serviços"}
          </p>
          {(serviceQuery || serviceCategory) && (
            <button
              type="button"
              onClick={() => {
                setServiceQuery("");
                setServiceCategory(null);
              }}
              className="min-h-11 rounded-full px-3 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Mostrar todos
            </button>
          )}
        </div>

        {visibleServices.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card p-8 text-center">
            <Search className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Nenhum serviço encontrado</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Tente outro nome ou remova o filtro de categoria.
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
          {visibleServices.map((s) => {
            const Icon = iconForService(s.category);
            const selected = serviceIds.includes(s.id);
            return (
            <button
              key={s.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setProId(null);
                setSlot(null);
                setServiceIds((current) =>
                  current.includes(s.id)
                    ? current.filter((id) => id !== s.id)
                    : [...current, s.id],
                );
              }}
              className={`relative flex min-h-36 w-full flex-col rounded-2xl border bg-card p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:border-primary"
              }`}
            >
              <div className="flex w-full items-start justify-between gap-3">
                <div
                  className="grid h-11 w-11 place-items-center rounded-xl"
                  style={{ background: `${s.colorHex ?? "#7DF89B"}33` }}
                >
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <span className={`grid h-6 w-6 place-items-center rounded-full border ${
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}>
                  {selected && <Check className="h-3.5 w-3.5" />}
                </span>
              </div>
              <p className="mt-3 line-clamp-2 font-medium leading-snug">{s.name}</p>
              {s.description && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {s.description}
                </p>
              )}
              <div className="mt-auto flex w-full items-end justify-between gap-2 pt-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {serviceCategoryLabel(s)}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDuration(s.durationMin)}</p>
                </div>
                <p className="text-sm font-semibold text-primary">
                  {formatMoney(s.priceCents, currency)}
                </p>
              </div>
            </button>
            );
          })}
        </div>
        )}
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-t border-border/70 bg-background/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] backdrop-blur">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatDuration(totalDuration)}</span>
            <span>{formatMoney(totalServicePrice, currency)}</span>
          </div>
          <button
            type="button"
            disabled={selectedServices.length === 0 || eligibleProfessionals.length === 0}
            onClick={() => setChoosingServices(false)}
            className="min-h-12 w-full rounded-full bg-primary px-5 py-3 text-base font-semibold text-primary-foreground disabled:opacity-40"
          >
            Continuar com {selectedServices.length} {selectedServices.length === 1 ? "serviço" : "serviços"}
          </button>
          {selectedServices.length > 0 && eligibleProfessionals.length === 0 && (
            <p className="mt-2 text-center text-xs text-destructive">
              Nenhum profissional realiza todos os serviços selecionados.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="animate-fade-in min-h-dvh space-y-8 px-5 pb-28 pt-6">
      <FlowHeader
        title="Agendamento"
        onBack={() => setChoosingServices(true)}
        subtitle={`${serviceName} · ${formatDuration(totalDuration)}`}
      />

      {/* Escolher profissional — cards com prova social real */}
      <div>
        <h3 className="mb-4 text-sm font-semibold">Escolher profissional</h3>
        {eligibleProfessionals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum profissional realiza esse serviço ainda.
          </p>
        ) : (
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {eligibleProfessionals.map((p) => {
              const selected = p.id === proId;
              const specialty = p.specialties.find(
                (name) => !selectedServices.some((service) => service.name === name),
              ) ?? p.specialties[0];
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
              className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Mês anterior"
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
              className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Próximo mês"
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
              const past = format(d, "yyyy-MM-dd") < todayDate;
              const selected = isSameDay(d, date);
              const disabled = past || !inMonth;
              return (
                <button
                  key={d.toISOString()}
                  disabled={disabled}
                  onClick={() => setDate(d)}
                  className={`grid h-11 place-items-center rounded-full text-sm transition ${
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
          <div className="grid grid-cols-3 gap-2 min-[380px]:grid-cols-4">
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
                  className={`relative min-h-11 rounded-full border px-2 py-2 text-sm transition ${
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

      {/* Horários ocupados — entrar na fila de espera */}
      {!slotsLoading && proId && occupied.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Ocupados — entre na fila
          </h3>
          <div className="grid grid-cols-3 gap-2 min-[380px]:grid-cols-4">
            {occupied.map((o) => {
              const joined = waitlistJoined?.appointmentId === o.appointmentId;
              return (
                <button
                  key={o.appointmentId}
                  onClick={() => {
                    setWaitlistError(null);
                    setWaitlistTarget(joined ? null : o);
                  }}
                  disabled={joined}
                  className={`min-h-11 rounded-full border px-2 py-2 text-xs transition ${
                    joined
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-dashed border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {joined ? "Na fila ✓" : o.time}
                </button>
              );
            })}
          </div>

          {waitlistJoined && (
            <div
              role="status"
              aria-live="polite"
              className="mt-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
            >
              <p className="font-semibold text-primary">Você entrou na fila de espera.</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Serviço</dt>
                <dd className="text-right font-medium">{waitlistJoined.serviceName}</dd>
                <dt className="text-muted-foreground">Profissional</dt>
                <dd className="text-right font-medium">
                  {waitlistJoined.professionalName}
                </dd>
                <dt className="text-muted-foreground">Data</dt>
                <dd className="text-right font-medium">
                  {waitlistJoined.dateLabel} às {waitlistJoined.time}
                </dd>
                <dt className="text-muted-foreground">Sua posição</dt>
                <dd className="text-right font-semibold text-primary">#{waitlistJoined.position}</dd>
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Se esse horário ficar disponível e você for o primeiro da fila, sua visita será
                confirmada automaticamente.
              </p>
              {clientSession && (
                <Link
                  href={`/book/${salonSlug}/minhas`}
                  className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-primary"
                >
                  Acompanhar em Minhas visitas
                </Link>
              )}
            </div>
          )}

          {waitlistTarget && (
            <div className="mt-3 rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-medium">Entrar na fila das {waitlistTarget.time}?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Se quem tem esse horário cancelar, você é confirmado automaticamente nele. O
                salão pode entrar em contato — não há confirmação instantânea garantida.
              </p>
              {!clientSession && (
                <div className="mt-3 space-y-2">
                  <input
                    value={waitlistName}
                    onChange={(e) => setWaitlistName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  />
                  <input
                    value={waitlistPhone}
                    onChange={(e) => setWaitlistPhone(formatPhoneBR(e.target.value))}
                    placeholder="WhatsApp — (11) 91234-5678"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              )}
              {waitlistError && (
                <p className="mt-2 text-xs text-destructive">{waitlistError}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setWaitlistTarget(null)}
                  disabled={waitlistLoading}
                  className="min-h-11 flex-1 rounded-full border border-border px-3 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={joinWaitlist}
                  disabled={
                    waitlistLoading ||
                    (!clientSession && (!waitlistName || !isValidPhoneBR(waitlistPhone)))
                  }
                  className="min-h-11 flex-1 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {waitlistLoading ? "Entrando…" : "Entrar na fila"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Identidade — só quando logado e horário selecionado */}
      {slot && clientSession && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
            {clientSession.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
          </div>
          <div>
            <p className="text-sm font-medium">{clientSession.name}</p>
            <p className="text-xs text-muted-foreground">{clientSession.email}</p>
          </div>
        </div>
      )}

      {/* Auth step — aparece apenas ao clicar em Confirmar sem sessão */}
      {authStep !== "hidden" && !clientSession && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          {authStep === "prompt" && (
            <>
              <p className="text-sm font-semibold">Como deseja continuar?</p>
              <Link
                href={`/book/${salonSlug}/login${returnToParam}`}
                onClick={saveBookingState}
                className="flex items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground"
              >
                <LogIn className="h-4 w-4" />
                Entrar na minha conta
              </Link>
              <Link
                href={`/book/${salonSlug}/cadastro${returnToParam}`}
                onClick={saveBookingState}
                className="flex items-center justify-center gap-2 rounded-full border border-border py-3 text-sm font-medium"
              >
                <UserPlus className="h-4 w-4" />
                Criar conta
              </Link>
              <button
                onClick={() => setAuthStep("guest-form")}
                className="w-full py-2 text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Continuar sem conta
              </button>
            </>
          )}
          {authStep === "guest-form" && (
            <>
              <p className="text-sm font-semibold">Seus dados</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneBR(e.target.value))}
                placeholder="WhatsApp — (11) 91234-5678"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {phone && !isValidPhoneBR(phone) && (
                <p className="text-xs text-muted-foreground">
                  Digite o DDD + número completo.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                <button
                  onClick={() => setAuthStep("prompt")}
                  className="text-primary hover:underline"
                >
                  Voltar
                </button>
                {" "}para entrar ou criar conta
              </p>
            </>
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

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-t border-border/70 bg-background/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] backdrop-blur">
        <button
          onClick={handleConfirmClick}
          disabled={
            !proId ||
            !slot ||
            (authStep === "guest-form" && (!name || !isValidPhoneBR(phone))) ||
            loading
          }
          className="min-h-12 w-full rounded-full bg-primary px-5 py-3 text-base font-semibold text-primary-foreground shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
        >
          {loading
            ? "Confirmando…"
            : rescheduleId
              ? "Confirmar remarcação"
              : "Confirmar agendamento"}
        </button>
      </div>
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
    const dt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const end = new Date(booked.startAt.getTime() + booked.durationMin * 60_000);
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SalonSaaS//Agendamento//PT",
      "BEGIN:VEVENT",
      `UID:${Date.now()}@salonsaas`,
      `DTSTAMP:${dt(new Date())}`,
      `DTSTART:${dt(booked.startAt)}`,
      `DTEND:${dt(end)}`,
      `SUMMARY:${booked.serviceName} — ${salonName}`,
      `DESCRIPTION:Com ${booked.proName}. Reserva feita via ${salonName}.`,
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
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="animate-pop mb-6 grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_40px_-8px_hsl(var(--primary))]">
        <Check className="check-draw h-8 w-8" strokeWidth={2.5} />
      </div>
      <h1 className="animate-rise font-display text-2xl [animation-delay:150ms]">
        Reserva confirmada
      </h1>
      <p className="animate-rise mt-1 text-sm text-muted-foreground [animation-delay:220ms]">
        Te esperamos lá 👇
      </p>

      {/* Cartão */}
      <div className="animate-slide-up relative mt-8 w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card [animation-delay:280ms]">
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
              {formatInTimeZone(booked.startAt, booked.timezone, "HH:mm")}
            </p>
            <p className="mt-2 text-sm capitalize text-foreground">
              {formatInTimeZone(
                booked.startAt,
                booked.timezone,
                "EEEE, d 'de' MMMM",
                { locale: ptBR },
              )}
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
              Fuso do local
            </p>
            <p className="mt-1 text-sm font-medium">{booked.timezone}</p>
          </div>
        </div>
      </div>

      <div className="animate-rise mt-8 flex w-full max-w-sm flex-col gap-2 [animation-delay:450ms]">
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
