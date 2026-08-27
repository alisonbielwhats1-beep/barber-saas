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
  ShoppingBag,
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
import { effectivePublicBookingLeadDays } from "@/lib/pricing";
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
  eligibleProfessionalsForServices,
  getServiceCategories,
  serviceCategoryLabel,
} from "@/lib/service-discovery";
import {
  AvailabilityRequestError,
  availabilityErrorMessage,
  requestAvailability,
} from "@/lib/availability-client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Pro = {
  id: string;
  name: string;
  avatarUrl: string | null;
  colorHex: string | null;
  specialties: string[];
  apptCount: number;
  topPro: boolean;
};

type PendingAvailabilitySlot = {
  slot: string;
  queryKey: string;
};

function availabilityQueryKey(
  salonId: string,
  professionalId: string,
  selectedServiceIds: string[],
  dateKey: string,
) {
  return [salonId, professionalId, selectedServiceIds.join(","), dateKey].join("|");
}
type Service = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMin: number;
  colorHex: string | null;
  category: string | null;
  imageUrl: string | null;
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
  salonAddress,
  currency,
  timezone,
  cancelPolicyHours,
  maxBookingLeadDays,
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
  salonAddress: string | null;
  currency: string;
  timezone: string;
  cancelPolicyHours: number;
  maxBookingLeadDays?: number;
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
  const [servicePrices, setServicePrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(services.map((service) => [service.id, service.priceCents])),
  );
  const [pricingLabel, setPricingLabel] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<AvailabilityRequestError | null>(null);
  const [retryUntilMs, setRetryUntilMs] = useState<number | null>(null);
  const [retryClockMs, setRetryClockMs] = useState(0);
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
  const [waitlistAuthStep, setWaitlistAuthStep] = useState<"prompt" | "guest-form">("prompt");
  const [name, setName] = useState(clientSession?.name ?? "");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [bookingStateReady, setBookingStateReady] = useState(false);
  // "hidden" → no auth prompt yet; "prompt" → show login/guest options; "guest-form" → collecting name+phone
  const [authStep, setAuthStep] = useState<"hidden" | "prompt" | "guest-form">("hidden");
  const idempotencyKeyRef = useRef<string | null>(null);
  const authPanelRef = useRef<HTMLDivElement>(null);
  const availabilityQueryRef = useRef<string | null>(null);
  const availabilityRequestRef = useRef(0);
  const retryUntilRef = useRef<number | null>(null);

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
    return eligibleProfessionalsForServices(selectedServices);
  }, [selectedServices]);
  const serviceName = selectedServices.map((service) => service.name).join(" + ");
  const totalDuration = selectedServices.reduce(
    (sum, service) => sum + service.durationMin,
    0,
  );
  const totalServicePrice = selectedServices.reduce(
    (sum, service) => sum + (servicePrices[service.id] ?? service.priceCents),
    0,
  );
  const publicLeadDays = effectivePublicBookingLeadDays(maxBookingLeadDays ?? 60);
  const maxBookingDate = new Date(`${todayDate}T12:00:00`);
  maxBookingDate.setDate(maxBookingDate.getDate() + publicLeadDays);
  const maxBookingDateKey = format(maxBookingDate, "yyyy-MM-dd");
  const selectedProfessional = eligibleProfessionals.find(
    (professional) => professional.id === proId,
  ) ?? null;

  // O cliente só precisa escolher quando existe mais de uma opção. A
  // compatibilidade continua sendo validada novamente no servidor.
  useEffect(() => {
    const currentIsEligible = proId
      ? eligibleProfessionals.some((professional) => professional.id === proId)
      : false;
    if (currentIsEligible) return;

    const nextProfessional = eligibleProfessionals.length === 1
      ? eligibleProfessionals[0]!.id
      : null;
    setProId(nextProfessional);
    setSlot(null);
  }, [eligibleProfessionals, proId]);

  // Slot a restaurar depois que a grade de horários carregar (fluxo returnTo)
  const pendingSlotRef = useRef<PendingAvailabilitySlot | null>(null);

  function invalidatePendingSlot() {
    pendingSlotRef.current = null;
  }

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
        waitlistTarget?: { appointmentId?: string; time?: string };
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
      if (s.waitlistTarget?.appointmentId && s.waitlistTarget.time) {
        setWaitlistTarget({
          appointmentId: s.waitlistTarget.appointmentId,
          time: s.waitlistTarget.time,
        });
        setWaitlistAuthStep(clientSession ? "guest-form" : "prompt");
      }
      if (s.date && s.date >= todayDate && s.date <= maxBookingDateKey) {
        const d = new Date(`${s.date}T12:00:00`);
        setDate(d);
        setViewMonth(startOfMonth(d));
      }
      if (s.slot && s.proId && s.date && s.date >= todayDate && s.date <= maxBookingDateKey && validIds.length > 0) {
        pendingSlotRef.current = {
          slot: s.slot,
          queryKey: availabilityQueryKey(
            salonId,
            s.proId,
            [...new Set(validIds)],
            s.date,
          ),
        };
        // Mantém a escolha visível, mas o CTA segue bloqueado até a API
        // confirmar que o horário ainda pertence à resposta atual.
        setSlot(s.slot);
      }
    } catch {
      // Storage indisponível não pode bloquear o agendamento.
    } finally {
      setBookingStateReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mantém a jornada depois de refresh ou retorno do login, sem persistir
  // nome, telefone ou qualquer outro dado pessoal.
  useEffect(() => {
    if (!bookingStateReady) return;
    try {
      sessionStorage.setItem(
        `booking-state:${salonSlug}`,
        JSON.stringify({
          serviceIds,
          proId,
          date: format(date, "yyyy-MM-dd"),
          slot,
          waitlistTarget,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // A URL com os serviços ainda preserva o retorno do fluxo de login.
    }
  }, [bookingStateReady, date, proId, salonSlug, serviceIds, slot, waitlistTarget]);

  useEffect(() => {
    if (retryUntilMs === null) return;

    function updateRetryClock() {
      const now = Date.now();
      if (retryUntilRef.current !== null && now >= retryUntilRef.current) {
        retryUntilRef.current = null;
        setRetryUntilMs(null);
      }
      setRetryClockMs(now);
    }

    updateRetryClock();
    const timer = window.setInterval(updateRetryClock, 250);
    return () => window.clearInterval(timer);
  }, [retryUntilMs]);

  const retrySecondsRemaining = retryUntilMs === null
    ? 0
    : Math.max(0, Math.ceil((retryUntilMs - retryClockMs) / 1_000));

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
          waitlistTarget,
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
    const requestId = ++availabilityRequestRef.current;
    if (selectedServices.length === 0 || !proId) {
      setSlots([]);
      setPopularSlot(null);
      setOccupied([]);
      setServicePrices(Object.fromEntries(services.map((service) => [service.id, service.priceCents])));
      setPricingLabel(null);
      setSlotsError(null);
      setSlotsLoading(false);
      if (!pendingSlotRef.current) setSlot(null);
      availabilityQueryRef.current = null;
      return;
    }

    const queryKey = availabilityQueryKey(
      salonId,
      proId,
      serviceIds,
      format(date, "yyyy-MM-dd"),
    );
    const queryChanged = availabilityQueryRef.current !== queryKey;
    availabilityQueryRef.current = queryKey;
    if (queryChanged) {
      setSlots([]);
      setPopularSlot(null);
      setOccupied([]);
      setServicePrices(Object.fromEntries(
        selectedServices.map((service) => [service.id, service.priceCents]),
      ));
      setPricingLabel(null);
      if (pendingSlotRef.current?.queryKey !== queryKey) setSlot(null);
    }

    if (retryUntilRef.current !== null && retryUntilRef.current > Date.now()) {
      setSlotsLoading(false);
      return;
    }

    const controller = new AbortController();
    setSlotsLoading(true);
    setSlotsError(null);
    retryUntilRef.current = null;
    setRetryUntilMs(null);
    const params = new URLSearchParams({
      salonId,
      professionalId: proId,
      serviceId: serviceIds.join(","),
      date: format(date, "yyyy-MM-dd"),
    });
    requestAvailability(`/api/availability?${params}`, { signal: controller.signal })
      .then((result) => {
        if (availabilityRequestRef.current !== requestId) return;
        setSlots(result.slots);
        setPopularSlot(result.popularSlot);
        setOccupied(result.occupied);
        const returnedPrices = new Map(
          (result.servicePrices ?? []).map((service) => [service.id, service.priceCents]),
        );
        setServicePrices(Object.fromEntries(
          selectedServices.map((service) => [
            service.id,
            returnedPrices.get(service.id) ?? service.priceCents,
          ]),
        ));
        setPricingLabel(result.pricing?.label ?? null);
        // Fluxo returnTo: re-seleciona o horário salvo se ainda estiver livre
        setSlot((current) => {
          const pending = pendingSlotRef.current;
          if (
            pending?.queryKey === queryKey &&
            result.slots.includes(pending.slot)
          ) {
            return pending.slot;
          }
          return current && result.slots.includes(current) ? current : null;
        });
        if (pendingSlotRef.current?.queryKey === queryKey) {
          pendingSlotRef.current = null;
        }
      })
      .catch((requestError: unknown) => {
        if (
          availabilityRequestRef.current !== requestId ||
          (requestError instanceof AvailabilityRequestError && requestError.code === "aborted")
        ) {
          return;
        }
        const availabilityError = requestError instanceof AvailabilityRequestError
          ? requestError
          : new AvailabilityRequestError("network");
        setSlots([]);
        setPopularSlot(null);
        setOccupied([]);
        setServicePrices(Object.fromEntries(selectedServices.map((service) => [service.id, service.priceCents])));
        setPricingLabel(null);
        setSlotsError(availabilityError);
        if (
          availabilityError.code === "rate_limited" &&
          availabilityError.retryAfterSeconds !== null &&
          availabilityError.retryAfterSeconds > 0
        ) {
          const now = Date.now();
          const retryUntil = now + availabilityError.retryAfterSeconds * 1_000;
          retryUntilRef.current = retryUntil;
          setRetryClockMs(now);
          setRetryUntilMs(retryUntil);
        } else {
          retryUntilRef.current = null;
          setRetryUntilMs(null);
        }
      })
      .finally(() => {
        if (availabilityRequestRef.current === requestId) setSlotsLoading(false);
      });
    return () => controller.abort();
  }, [salonId, services, selectedServices, serviceIds, proId, date, slotsVersion]);

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
    if (
      selectedServices.length === 0 ||
      !proId ||
      !slot ||
      !slots.includes(slot) ||
      slotsLoading ||
      slotsError
    ) return;
    if (clientSession) {
      setReviewing(true);
    } else if (authStep === "guest-form" && name && isValidPhoneBR(phone)) {
      setReviewing(true);
    } else if (authStep === "guest-form") {
      // form visible but not filled
    } else {
      setAuthStep("prompt");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => authPanelRef.current?.focus({ preventScroll: false }));
      });
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
        try {
          sessionStorage.removeItem(`booking-state:${salonSlug}`);
        } catch {}
        setBooked({
          startAt: confirmedStart,
          timezone,
          serviceName,
          durationMin: totalDuration,
          proName: pro?.name ?? "",
        });
      } else {
        setReviewing(false);
        setError(friendlyError(responseBody.error));
        if (responseBody.error === "SLOT_TAKEN") {
          idempotencyKeyRef.current = null;
          setSlot(null);
          setSlotsVersion((version) => version + 1);
        }
      }
    } catch {
      setReviewing(false);
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
        guest={!clientSession}
      />
    );
  }

  // Seleção explícita permite combinar serviços antes do profissional.
  if (choosingServices) {
    return (
      <>
        <section className="animate-fade-in min-h-dvh space-y-6 px-5 pb-32 pt-6">
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
              <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                {selectedServices.map((service) => service.name).join(" + ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                invalidatePendingSlot();
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
                invalidatePendingSlot();
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
                {s.imageUrl ? (
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl">
                    <Image
                      src={s.imageUrl}
                      alt=""
                      fill
                      sizes="44px"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div
                    className="grid h-11 w-11 place-items-center rounded-xl"
                    style={{ background: `${s.colorHex ?? "#7DF89B"}33` }}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
                  </div>
                )}
                <span className={`grid h-6 w-6 place-items-center rounded-full border ${
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}>
                  {selected && <Check className="h-3.5 w-3.5" />}
                </span>
              </div>
              <p className="mt-3 break-words font-medium leading-snug">{s.name}</p>
              {s.description && (
                <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
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
        </section>
        <div data-booking-tray className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-t border-border/70 bg-background/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] backdrop-blur">
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
      </>
    );
  }

  return (
    <>
    <section className="animate-fade-in min-h-dvh space-y-8 px-5 pb-32 pt-6">
      <FlowHeader
        title="Agendamento"
        onBack={() => setChoosingServices(true)}
        subtitle={`${serviceName} · ${formatDuration(totalDuration)}`}
      />

      {/* Escolher profissional — cards com prova social real */}
      <div>
        <h3 className="mb-1 text-sm font-semibold">
          {eligibleProfessionals.length === 1 ? "Profissional" : "Escolher profissional"}
        </h3>
        {eligibleProfessionals.length === 1 && selectedProfessional && (
          <p role="status" aria-live="polite" className="mb-4 text-xs text-muted-foreground">
            {selectedProfessional.name} foi selecionado automaticamente por realizar todos os serviços.
          </p>
        )}
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
                  type="button"
                  key={p.id}
                  aria-pressed={selected}
                  disabled={eligibleProfessionals.length === 1}
                  onClick={() => {
                    invalidatePendingSlot();
                    setProId(p.id);
                    setSlot(null);
                  }}
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
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              disabled={format(viewMonth, "yyyy-MM") <= todayDate.slice(0, 7)}
              className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
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
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              disabled={format(addMonths(viewMonth, 1), "yyyy-MM-dd") > maxBookingDateKey}
              className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
            {[
              ["S", "segunda-feira"],
              ["T", "terça-feira"],
              ["Q", "quarta-feira"],
              ["Q", "quinta-feira"],
              ["S", "sexta-feira"],
              ["S", "sábado"],
              ["D", "domingo"],
            ].map(([shortLabel, fullLabel]) => (
              <span key={fullLabel} className="py-1">
                <span aria-hidden="true">{shortLabel}</span>
                <span className="sr-only">{fullLabel}</span>
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((d) => {
              const inMonth = isSameMonth(d, viewMonth);
              const dateKey = format(d, "yyyy-MM-dd");
              const past = dateKey < todayDate;
              const beyondWindow = dateKey > maxBookingDateKey;
              const selected = isSameDay(d, date);
              const disabled = past || beyondWindow || !inMonth;
              return (
                <button
                  type="button"
                  key={d.toISOString()}
                  disabled={disabled}
                  onClick={() => {
                    invalidatePendingSlot();
                    setSlot(null);
                    setDate(d);
                  }}
                  aria-label={format(d, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  aria-pressed={selected}
                  aria-current={format(d, "yyyy-MM-dd") === todayDate ? "date" : undefined}
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
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Agendamento online disponível até {format(maxBookingDate, "dd/MM/yyyy")}.
          </p>
          {pricingLabel && (
            <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-center text-[11px] font-medium text-warning">
              {pricingLabel}: o valor especial aparece no resumo da reserva.
            </p>
          )}
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
        ) : slotsError ? (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-5 text-center"
          >
            <p className="text-sm font-medium text-foreground">
              {slotsError.code === "rate_limited" && retrySecondsRemaining > 0
                ? "Muitas consultas em pouco tempo. Aguarde o tempo indicado para tentar novamente."
                : availabilityErrorMessage(slotsError)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {slot
                ? `O horário ${slot} e suas demais escolhas foram preservados.`
                : "Serviço, profissional e data continuam selecionados."}
            </p>
            <button
              type="button"
              onClick={() => setSlotsVersion((version) => version + 1)}
              disabled={retrySecondsRemaining > 0}
              className="mt-3 min-h-11 rounded-full border border-border-strong bg-card px-5 text-sm font-semibold text-foreground transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retrySecondsRemaining > 0
                ? `Tentar novamente em ${retrySecondsRemaining}s`
                : "Tentar novamente"}
            </button>
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
                  type="button"
                  key={s}
                  onClick={() => setSlot(s)}
                  aria-label={`Horário ${s}${popular ? ", muito procurado" : ""}`}
                  aria-pressed={selected}
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
                    if (joined) {
                      setWaitlistTarget(null);
                      return;
                    }
                    setWaitlistAuthStep(clientSession ? "guest-form" : "prompt");
                    setWaitlistTarget(o);
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
                Se esse horário ficar disponível, o sistema pode confirmar automaticamente a
                primeira pessoa quando o cancelamento vier do cliente. Se o salão cancelar, a
                equipe promove a fila pela ordem e você acompanha o status em Minhas visitas.
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
                Se a vaga for liberada, a confirmação segue a ordem da fila. Cancelamentos de
                clientes podem confirmar automaticamente; quando o salão cancela, a equipe
                escolhe a primeira pessoa. Você acompanha tudo em Minhas visitas.
              </p>
              {!clientSession && waitlistAuthStep === "prompt" && (
                <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs font-medium">Entre ou crie sua conta para acompanhar a fila.</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Assim você recebe a confirmação no app se o horário for liberado. Também é possível continuar como visitante.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Link
                      href={`/book/${salonSlug}/login${returnToParam}`}
                      onClick={saveBookingState}
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground"
                    >
                      <LogIn className="h-3.5 w-3.5" /> Entrar
                    </Link>
                    <Link
                      href={`/book/${salonSlug}/cadastro${returnToParam}`}
                      onClick={saveBookingState}
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-primary/40 px-3 text-xs font-semibold text-primary"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Criar conta
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWaitlistAuthStep("guest-form")}
                    className="mt-2 min-h-11 w-full rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-background"
                  >
                    Continuar como visitante
                  </button>
                </div>
              )}
              {!clientSession && waitlistAuthStep === "guest-form" && (
                <div className="mt-3 space-y-2">
                  <label htmlFor="waitlist-name" className="block text-[11px] font-medium text-muted-foreground">Seu nome</label>
                  <input
                    id="waitlist-name"
                    value={waitlistName}
                    onChange={(e) => setWaitlistName(e.target.value)}
                    placeholder="Nome completo"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  />
                  <label htmlFor="waitlist-phone" className="block text-[11px] font-medium text-muted-foreground">Seu WhatsApp</label>
                  <input
                    id="waitlist-phone"
                    type="tel"
                    inputMode="tel"
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
                    !clientSession && waitlistAuthStep !== "guest-form" ||
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
        <div
          ref={authPanelRef}
          tabIndex={-1}
          className="space-y-3 rounded-2xl border border-border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {authStep === "prompt" && (
            <>
              <p className="text-sm font-semibold">Quase lá</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Você pode reservar agora sem criar conta. Depois, se quiser, acompanhe tudo em Minhas reservas.
              </p>
              <button
                onClick={() => setAuthStep("guest-form")}
                className="flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
              >
                Continuar sem conta
              </button>
              <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
              </div>
              <Link
                href={`/book/${salonSlug}/login${returnToParam}`}
                onClick={saveBookingState}
                className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-border py-3 text-sm font-medium"
              >
                <LogIn className="h-4 w-4" />
                Entrar na minha conta
              </Link>
              <Link
                href={`/book/${salonSlug}/cadastro${returnToParam}`}
                onClick={saveBookingState}
                className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-border py-3 text-sm font-medium"
              >
                <UserPlus className="h-4 w-4" />
                Criar conta
              </Link>
            </>
          )}
          {authStep === "guest-form" && (
            <>
              <p className="text-sm font-semibold">Seus dados</p>
              <label htmlFor="guest-name" className="sr-only">Seu nome</label>
              <input
                id="guest-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <label htmlFor="guest-phone" className="sr-only">Seu WhatsApp</label>
              <input
                id="guest-phone"
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
            <ShoppingBag className="mr-1.5 inline-block h-4 w-4 align-[-0.2em]" aria-hidden="true" />
            {cart.count} {cart.count === 1 ? "produto" : "produtos"} do carrinho
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

      </section>
      <div data-booking-tray className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-t border-border/70 bg-background/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] backdrop-blur">
        <button
          onClick={handleConfirmClick}
          disabled={
            !proId ||
            !slot ||
            !slots.includes(slot) ||
            slotsLoading ||
            Boolean(slotsError) ||
            (authStep === "guest-form" && (!name || !isValidPhoneBR(phone))) ||
            loading
          }
          className="min-h-12 w-full rounded-full bg-primary px-5 py-3 text-base font-semibold text-primary-foreground shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
        >
          {loading
            ? "Confirmando…"
            : rescheduleId
              ? "Confirmar remarcação"
              : clientSession || authStep === "guest-form"
                ? "Revisar reserva"
                : "Continuar"}
        </button>
      </div>
      {reviewing && selectedProfessional && slot && (
        <BookingReview
          salonName={salonName}
          salonAddress={salonAddress}
          serviceName={serviceName}
          professionalName={selectedProfessional.name}
          date={date}
          slot={slot}
          durationMin={totalDuration}
          totalCents={totalServicePrice + cart.totalCents}
          pricingLabel={pricingLabel}
          currency={currency}
          cancelPolicyHours={cancelPolicyHours}
          loading={loading}
          onBack={() => setReviewing(false)}
          onConfirm={submit}
          rescheduling={Boolean(rescheduleId)}
        />
      )}
    </>
  );
}

function BookingReview({
  salonName,
  salonAddress,
  serviceName,
  professionalName,
  date,
  slot,
  durationMin,
  totalCents,
  pricingLabel,
  currency,
  cancelPolicyHours,
  loading,
  onBack,
  onConfirm,
  rescheduling,
}: {
  salonName: string;
  salonAddress: string | null;
  serviceName: string;
  professionalName: string;
  date: Date;
  slot: string;
  durationMin: number;
  totalCents: number;
  pricingLabel: string | null;
  currency: string;
  cancelPolicyHours: number;
  loading: boolean;
  onBack: () => void;
  onConfirm: () => void;
  rescheduling: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !loading && onBack()}>
      <DialogContent className="bottom-0 top-auto max-w-[480px] -translate-y-0 gap-0 rounded-b-none rounded-t-3xl bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{salonName}</p>
        <DialogTitle className="mt-1 text-xl">Revise sua reserva</DialogTitle>
        <DialogDescription className="sr-only">
          Confira serviços, profissional, data, duração e total antes de confirmar.
        </DialogDescription>
        <dl className="mt-5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card px-4">
          <ReviewRow label="Serviços" value={serviceName} />
          <ReviewRow label="Profissional" value={professionalName} />
          <ReviewRow
            label="Data e hora"
            value={`${format(date, "EEEE, d 'de' MMMM", { locale: ptBR })} às ${slot}`}
          />
          <ReviewRow label="Duração" value={formatDuration(durationMin)} />
          <ReviewRow label="Total" value={formatMoney(totalCents, currency)} strong />
        </dl>
        {pricingLabel && (
          <p className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
            {pricingLabel} aplicado ao valor dos serviços.
          </p>
        )}
        {salonAddress && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{salonAddress}</p>}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Cancelamento ou remarcação pelo app até {cancelPolicyHours}h antes do horário.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="min-h-12 rounded-full border border-border px-4 text-sm font-medium disabled:opacity-50"
          >
            Alterar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="min-h-12 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {loading ? "Confirmando…" : rescheduling ? "Confirmar remarcação" : "Confirmar reserva"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right ${strong ? "font-semibold text-primary" : "font-medium"}`}>{value}</dd>
    </div>
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
  guest,
}: {
  booked: Booked;
  salonName: string;
  salonSlug: string;
  guest: boolean;
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
        {guest && (
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Para alterar esta reserva pelo app depois, crie uma conta com os mesmos dados ou fale com o salão.
          </p>
        )}
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
