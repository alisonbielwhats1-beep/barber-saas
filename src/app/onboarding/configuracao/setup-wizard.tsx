"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Leaf,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { normalizeSearch } from "@/components/ui/search-picker";
import { formatMoney } from "@/lib/utils";
import { ThemeProvider } from "@/app/(admin)/theme-provider";
import { ThemeToggle } from "@/app/(admin)/theme-toggle";
import { WorkingHoursForm } from "@/app/(admin)/profissionais/working-hours-form";
import {
  setupChecks,
  type SetupData,
  type SetupProfessional,
  type SetupService,
} from "@/lib/initial-setup";
import {
  scheduleLabel,
  scheduleTime,
  WEEKDAY_LABELS,
  type WeeklyHours,
} from "@/lib/team-schedule";
import {
  enableMySetupAgenda,
  saveSetupContact,
  saveSetupHours,
  saveSetupProfessional,
  saveSetupProgress,
  saveSetupService,
} from "./actions";
import "./setup.css";

const chapters = [
  { title: "Horários", icon: Clock3 },
  { title: "Serviços", icon: Leaf },
  { title: "Equipe", icon: Users },
  { title: "Divulgar", icon: Sparkles },
];
/** Segunda primeiro, como o calendário brasileiro de trabalho. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DURATIONS = [30, 45, 60, 90];
type Run = (work: () => Promise<void>) => void;

export function SetupWizard({
  data,
  initialStep,
  bookingUrl,
  nextHref,
  canCreateSelf,
}: {
  data: SetupData;
  initialStep: number;
  bookingUrl: string;
  nextHref: string;
  canCreateSelf: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [welcome, setWelcome] = useState(
    data.status === "new" && initialStep === 0,
  );
  const [refreshing, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pending = saving || refreshing;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const checks = setupChecks(data);
  const ready = checks.slice(0, 3).every(Boolean);
  const firstName = data.userName.trim().split(/\s+/)[0] || data.userName;
  useEffect(() => {
    heading.current?.focus();
  }, [step, welcome]);
  const run: Run = (work) => {
    if (savingRef.current || refreshing) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    void (async () => {
      try {
        await work();
        startTransition(() => router.refresh());
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Não foi possível salvar. Tente novamente.",
        );
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    })();
  };
  async function move(next: number) {
    await saveSetupProgress({ step: next, status: "active" });
    setWelcome(false);
    setStep(next);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?step=${next}&next=${encodeURIComponent(nextHref)}`,
    );
  }
  function leave() {
    run(async () => {
      await saveSetupProgress({
        step,
        status: data.status === "completed" && ready ? "completed" : "deferred",
      });
      router.push(nextHref);
    });
  }
  const done = checks.slice(0, 3).filter(Boolean).length + (ready ? 1 : 0);
  return (
    <ThemeProvider>
      <div className="setup-shell" data-setup-step={step}>
        <header className="setup-header">
          <BrandLogo className="!h-9 !w-[142px]" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" disabled={pending} onClick={leave}>
              Fazer depois
            </Button>
          </div>
        </header>
        <main id="main-content" className="setup-main" tabIndex={-1}>
          {!welcome && (
            <nav aria-label="Etapas de configuração" className="setup-chapters">
              <ol>
                {chapters.map((item, i) => (
                  <li key={item.title}>
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={`${i + 1}. ${item.title}`}
                      aria-current={step === i ? "step" : undefined}
                      className="setup-chapter"
                      data-done={checks[i] || undefined}
                      onClick={() => run(() => move(i))}
                    >
                      <span className="setup-chapter-bar" aria-hidden="true" />
                      <span className="setup-chapter-label">
                        {checks[i] && (
                          <Check size={12} strokeWidth={3} aria-hidden="true" />
                        )}
                        {item.title}
                      </span>
                      <span className="sr-only">
                        {checks[i] ? "Concluído" : "Pendente"}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <span
                className="sr-only"
                role="progressbar"
                aria-label="Etapas concluídas"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={done}
              />
            </nav>
          )}
          {error && (
            <p role="alert" className="setup-alert">
              {error}
            </p>
          )}
          <p role="status" className={message ? "setup-message" : "sr-only"}>
            {message}
          </p>

          {welcome && (
            <section className="setup-welcome" aria-labelledby="setup-title">
              <StepIcon icon={CalendarDays} floating />
              <p className="setup-kicker">Olá, {firstName}</p>
              <h1 id="setup-title" ref={heading} tabIndex={-1} className="setup-title">
                Vamos deixar sua agenda online pronta.
              </h1>
              <p className="setup-lead">
                São 4 passos curtos, uma decisão por vez. Leva uns 5 minutos e
                você pode parar quando quiser: tudo o que salvar fica guardado.
              </p>
              <ol className="setup-roadmap">
                {[
                  ["Seus horários", "Dias e horas em que você atende"],
                  ["Seus serviços", "O que o cliente agenda, com preço e duração"],
                  ["Sua equipe", "Quem atende cada serviço"],
                  ["Seu app pronto", "O link para mandar aos clientes"],
                ].map(([title, detail], i) => (
                  <li key={title}>
                    <span aria-hidden="true">{i + 1}</span>
                    <div>
                      <strong>{title}</strong>
                      <p>{detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="setup-cta"
                disabled={pending}
                onClick={() => setWelcome(false)}
              >
                Começar
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </section>
          )}

          {!welcome && step === 0 && (
            <HoursStep
              key={JSON.stringify(data.hours)}
              data={data}
              pending={pending}
              heading={heading}
              onSave={(hours) =>
                run(async () => {
                  await saveSetupHours(hours);
                  await move(1);
                })
              }
            />
          )}

          {!welcome && step === 1 && (
            <section aria-labelledby="setup-title" className="setup-step">
              <StepHeader
                icon={Leaf}
                kicker="Passo 2 · Serviços"
                heading={heading}
                title="O que você oferece?"
                lead="Confira preço e duração de cada serviço. É exatamente isso que o cliente verá ao agendar."
              />
              <SetupServiceCatalog
                services={data.services}
                run={run}
                pending={pending}
                onSaved={(next) =>
                  setMessage(
                    next
                      ? `Serviço salvo. Agora: ${next}.`
                      : "Serviço salvo. Você pode revisar outro ou continuar.",
                  )
                }
              />
              <div className="setup-actions">
                <button
                  type="button"
                  className="setup-cta"
                  disabled={pending}
                  onClick={() => run(() => move(2))}
                >
                  Continuar para equipe
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}

          {!welcome && step === 2 && (
            <section aria-labelledby="setup-title" className="setup-step">
              <StepHeader
                icon={Users}
                kicker="Passo 3 · Equipe"
                heading={heading}
                title="Quem vai atender?"
                lead="Ligue cada serviço a quem o realiza. Se você também atende, sua agenda usa a conta com que você entrou."
              />
              {canCreateSelf &&
                !data.professionals.some((p) => p.userId === data.userId) && (
                  <div className="setup-choices" role="group" aria-label="Quem atende">
                    <button
                      type="button"
                      className="setup-choice"
                      disabled={pending}
                      onClick={() => run(enableMySetupAgenda)}
                    >
                      <span className="setup-choice-icon" aria-hidden="true">
                        <UserRound size={22} />
                      </span>
                      <span>
                        <strong>Eu mesmo atendo</strong>
                        <span>Crie sua agenda agora, sem novo usuário ou senha.</span>
                      </span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                    <Link
                      href="/profissionais"
                      className="setup-choice"
                      onClick={(e) => {
                        e.preventDefault();
                        run(async () => {
                          await saveSetupProgress({ step: 2, status: "deferred" });
                          router.push("/profissionais");
                        });
                      }}
                    >
                      <span className="setup-choice-icon" aria-hidden="true">
                        <Users size={22} />
                      </span>
                      <span>
                        <strong>Tenho uma equipe</strong>
                        <span>Convide as pessoas em Profissionais e volte aqui.</span>
                      </span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </Link>
                  </div>
                )}
              {data.professionals.map((pro) => (
                <ProfessionalEditor
                  key={`${pro.id}-${JSON.stringify(pro.hours)}-${pro.serviceIds.join()}`}
                  pro={pro}
                  data={data}
                  run={run}
                  pending={pending}
                  onSaved={() =>
                    setMessage(
                      "Agenda configurada. Confira a próxima pessoa ou continue.",
                    )
                  }
                />
              ))}
              {data.professionals.length > 0 && (
                <p className="setup-note">
                  Mais pessoas na equipe? O cadastro e os convites ficam em{" "}
                  <Link
                    href="/profissionais"
                    className="setup-inline-link"
                    onClick={(e) => {
                      e.preventDefault();
                      run(async () => {
                        await saveSetupProgress({ step: 2, status: "deferred" });
                        router.push("/profissionais");
                      });
                    }}
                  >
                    Profissionais
                  </Link>
                  . Quando estiverem ativas, aparecem aqui.
                </p>
              )}
              <div className="setup-actions">
                <button
                  type="button"
                  className="setup-cta"
                  disabled={pending}
                  onClick={() => run(() => move(3))}
                >
                  Ver meu aplicativo
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}

          {!welcome && step === 3 && (
            <section aria-labelledby="setup-title" className="setup-step">
              <StepHeader
                icon={Sparkles}
                kicker="Passo 4 · Divulgar"
                heading={heading}
                title={
                  ready
                    ? "Pronto! Seus clientes já podem agendar."
                    : "Seu aplicativo para clientes."
                }
                lead="É assim que seus clientes veem o seu espaço. Mande o link no WhatsApp ou coloque na bio do Instagram."
              />
              <AppPreview data={data} />
              <div className="setup-card">
                <label className="setup-label" htmlFor="booking-link">
                  Link do aplicativo do cliente
                </label>
                <div className="setup-link-row">
                  <Input
                    id="booking-link"
                    className="!text-base"
                    readOnly
                    value={bookingUrl}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className="setup-cta setup-cta-compact"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        try {
                          await navigator.clipboard.writeText(bookingUrl);
                          setMessage(
                            "Link copiado! Cole onde quiser compartilhar com seus clientes.",
                          );
                        } catch {
                          setError(
                            "Não foi possível copiar automaticamente. Selecione o link acima e copie.",
                          );
                        }
                      })
                    }
                  >
                    <Copy size={16} aria-hidden="true" />
                    Copiar link
                  </button>
                </div>
                <div className="setup-share">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`Agende seu horário comigo pelo aplicativo: ${bookingUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="setup-secondary"
                  >
                    <MessageCircle size={16} aria-hidden="true" />
                    Enviar no WhatsApp
                    <span className="sr-only">em nova aba</span>
                  </a>
                  <a
                    href={bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="setup-secondary"
                  >
                    Abrir aplicativo
                    <ExternalLink size={16} aria-hidden="true" />
                    <span className="sr-only">em nova aba</span>
                  </a>
                </div>
                <p className="setup-note">
                  Depois você encontra o link e o QR Code em{" "}
                  <strong>Compartilhar</strong> (computador) ou em{" "}
                  <strong>Mais → Compartilhar</strong> (celular).
                </p>
              </div>
              <div className="setup-card">
                <h2 className="setup-card-title">
                  {ready
                    ? "Configuração essencial pronta"
                    : "Antes de divulgar, confira"}
                </h2>
                <ul className="setup-checklist">
                  {[
                    "Horários de atendimento definidos",
                    "Serviços com preço e duração revisados",
                    "Cada serviço com profissional e jornada compatível",
                  ].map((label, i) => (
                    <li key={label} data-done={checks[i] || undefined}>
                      <span className="setup-check" aria-hidden="true">
                        {checks[i] && <Check size={14} strokeWidth={3} />}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => move(i))}
                      >
                        {label}
                        <span className="sr-only">
                          {checks[i] ? ": concluído" : ": pendente"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="setup-note">
                  {ready
                    ? "A disponibilidade também considera reservas, pausas, folgas e bloqueios. Abra o aplicativo e confira os horários antes de divulgar."
                    : "Você já pode conhecer o aplicativo. Complete os itens pendentes para que o cliente encontre serviços e horários para agendar."}
                </p>
              </div>
              <ContactEditor
                key={`${data.salon.address}-${data.salon.phone}`}
                data={data}
                run={run}
                pending={pending}
                onSaved={() => setMessage("Dados de contato salvos.")}
              />
              <div className="setup-actions">
                <button
                  type="button"
                  className="setup-cta"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      await saveSetupProgress({
                        step: 3,
                        status: ready ? "completed" : "deferred",
                      });
                      router.push(nextHref);
                    })
                  }
                >
                  {ready ? "Concluir configuração" : "Continuar depois no painel"}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}

          {!welcome && (
            <footer className="setup-footer">
              {step > 0 && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => move(step - 1))}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Voltar
                </Button>
              )}
              {step < 3 && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => move(step + 1))}
                >
                  Pular esta etapa
                </Button>
              )}
              <span>
                {pending
                  ? "Salvando…"
                  : "Cada passo salvo fica guardado para quando você voltar."}
              </span>
            </footer>
          )}
        </main>
      </div>
    </ThemeProvider>
  );
}

function StepIcon({
  icon: Icon,
  floating = false,
}: {
  icon: typeof Clock3;
  floating?: boolean;
}) {
  return (
    <span
      className={floating ? "setup-icon setup-icon-float" : "setup-icon"}
      aria-hidden="true"
    >
      <span className="setup-icon-ring" />
      <Icon size={26} strokeWidth={1.8} />
    </span>
  );
}

function StepHeader({
  icon,
  kicker,
  title,
  lead,
  heading,
}: {
  icon: typeof Clock3;
  kicker: string;
  title: string;
  lead: ReactNode;
  heading: React.RefObject<HTMLHeadingElement>;
}) {
  return (
    <div className="setup-introduction">
      <StepIcon icon={icon} />
      <p className="setup-kicker">{kicker}</p>
      <h1 id="setup-title" ref={heading} tabIndex={-1} className="setup-title">
        {title}
      </h1>
      <p className="setup-lead">{lead}</p>
    </div>
  );
}

type Interval = { start: string; end: string };
type Preset = "direct" | "lunch" | "custom";
const minutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const endMinutes = (s: string) => (s === "00:00" ? 1440 : minutes(s));
const timeOf = (m: number) => (m === 1440 ? "00:00" : scheduleTime(m));

/** Deriva a escolha mais simples que reproduz exatamente os horários salvos. */
function initialHours(data: SetupData) {
  const byDay = WEEKDAY_LABELS.map((_, weekday) =>
    data.hours
      .filter((h) => h.weekday === weekday)
      .sort((a, b) => a.startMinutes - b.startMinutes)
      .map((h) => ({ start: timeOf(h.startMinutes), end: timeOf(h.endMinutes) })),
  );
  const open = data.hours.length
    ? byDay.map((d) => d.length > 0)
    : WEEKDAY_LABELS.map((_, weekday) => weekday > 0);
  const firstOpen = byDay.find((d) => d.length) ?? [];
  const uniform = byDay.every(
    (d, i) => !open[i] || JSON.stringify(d) === JSON.stringify(firstOpen),
  );
  const fallback = {
    start: timeOf(data.salon.openMinutes),
    end: timeOf(data.salon.closeMinutes),
  };
  let preset: Preset = "direct";
  let base: Interval[] = [fallback];
  if (data.hours.length) {
    if (uniform && firstOpen.length === 1) base = firstOpen;
    else if (uniform && firstOpen.length === 2) {
      preset = "lunch";
      base = firstOpen;
    } else preset = "custom";
  }
  const lunch =
    preset === "lunch"
      ? base
      : [
          { start: fallback.start, end: "12:00" },
          { start: "13:00", end: fallback.end },
        ];
  const perDay = byDay.map((d) => (d.length ? d : [{ ...fallback }]));
  return { open, preset, direct: preset === "direct" ? base[0] : fallback, lunch, perDay };
}

function HoursStep({
  data,
  pending,
  heading,
  onSave,
}: {
  data: SetupData;
  pending: boolean;
  heading: React.RefObject<HTMLHeadingElement>;
  onSave: (hours: WeeklyHours[]) => void;
}) {
  const initial = initialHours(data);
  const [screen, setScreen] = useState<"days" | "time">("days");
  const [open, setOpen] = useState(initial.open);
  const [preset, setPreset] = useState<Preset>(initial.preset);
  const [direct, setDirect] = useState(initial.direct);
  const [lunch, setLunch] = useState(initial.lunch);
  const [perDay, setPerDay] = useState(initial.perDay);
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    heading.current?.focus();
  }, [screen, heading]);
  const openCount = open.filter(Boolean).length;
  const openNames = WEEK_ORDER.filter((d) => open[d]).map((d) => WEEKDAY_LABELS[d]);
  const daysText =
    openNames.length <= 1
      ? openNames.join("")
      : `${openNames.slice(0, -1).join(", ")} e ${openNames[openNames.length - 1]}`;
  const intervals = (weekday: number): Interval[] =>
    preset === "direct" ? [direct] : preset === "lunch" ? lunch : perDay[weekday];
  const summary =
    preset === "custom"
      ? "horário diferente em cada dia"
      : intervals(1)
          .map((i) => `${i.start}–${i.end}`)
          .join(" e ");
  function rows(): WeeklyHours[] {
    return WEEKDAY_LABELS.flatMap((_, weekday) =>
      open[weekday]
        ? intervals(weekday).map((i) => ({
            weekday,
            startMinutes: minutes(i.start),
            endMinutes: endMinutes(i.end),
          }))
        : [],
    );
  }
  function setQuick(days: number[]) {
    setOpen(WEEKDAY_LABELS.map((_, weekday) => days.includes(weekday)));
  }
  if (screen === "days")
    return (
      <section aria-labelledby="setup-title" className="setup-step">
        <StepHeader
          icon={CalendarDays}
          kicker="Passo 1 · Horários"
          heading={heading}
          title="Em quais dias você atende?"
          lead="Toque para marcar. Seus clientes só verão horários nesses dias."
        />
        <div className="setup-days" role="group" aria-label="Dias de atendimento">
          {WEEK_ORDER.map((weekday) => (
            <button
              key={weekday}
              type="button"
              aria-pressed={open[weekday]}
              aria-label={WEEKDAY_LABELS[weekday]}
              className="setup-day-toggle"
              disabled={pending}
              onClick={() =>
                setOpen((current) =>
                  current.map((v, i) => (i === weekday ? !v : v)),
                )
              }
            >
              <strong>{WEEKDAY_LABELS[weekday].slice(0, 3)}</strong>
              <span aria-hidden="true">{open[weekday] ? "Atende" : "Fechado"}</span>
            </button>
          ))}
        </div>
        <div className="setup-quick" role="group" aria-label="Atalhos">
          <button type="button" onClick={() => setQuick([1, 2, 3, 4, 5])}>
            Seg a sex
          </button>
          <button type="button" onClick={() => setQuick([1, 2, 3, 4, 5, 6])}>
            Seg a sáb
          </button>
          <button type="button" onClick={() => setQuick([])}>
            Limpar
          </button>
        </div>
        <div className="setup-actions">
          <button
            type="button"
            className="setup-cta"
            disabled={pending || openCount === 0}
            onClick={() => setScreen("time")}
          >
            Continuar
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          {openCount === 0 && (
            <span className="setup-note">Marque pelo menos um dia.</span>
          )}
        </div>
      </section>
    );
  const presetOptions: { id: Preset; title: string; detail: string }[] = [
    { id: "direct", title: "Direto, sem pausa", detail: `${direct.start} às ${direct.end}` },
    {
      id: "lunch",
      title: "Com pausa para almoço",
      detail: lunch.map((i) => `${i.start}–${i.end}`).join(" e "),
    },
    { id: "custom", title: "Um horário para cada dia", detail: "Ajuste dia a dia" },
  ];
  return (
    <form
      aria-labelledby="setup-title"
      className="setup-step"
      onSubmit={(e) => {
        e.preventDefault();
        const hours = rows();
        if (hours.some((h) => h.endMinutes <= h.startMinutes)) {
          setLocalError("O fim de cada período deve ser depois do início.");
          return;
        }
        setLocalError("");
        onSave(hours);
      }}
    >
      <StepHeader
        icon={Clock3}
        kicker="Passo 1 · Horários"
        heading={heading}
        title="Qual é o seu horário nesses dias?"
        lead="Escolha o formato mais parecido com a sua rotina. Horários individuais já cadastrados serão preservados."
      />
      <fieldset disabled={pending} className="setup-options">
        <legend className="sr-only">Formato do horário</legend>
        {presetOptions.map((option) => (
          <label key={option.id} className="setup-option" data-selected={preset === option.id || undefined}>
            <input
              type="radio"
              name="preset"
              value={option.id}
              checked={preset === option.id}
              onChange={() => setPreset(option.id)}
            />
            <span>
              <strong>{option.title}</strong>
              <span>{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset disabled={pending} className="setup-card">
        <legend className="sr-only">Horários</legend>
        {preset === "direct" && (
          <div className="setup-times">
            <TimeField label="Abre às" value={direct.start} onChange={(start) => setDirect({ ...direct, start })} />
            <TimeField label="Fecha às" value={direct.end} onChange={(end) => setDirect({ ...direct, end })} />
          </div>
        )}
        {preset === "lunch" && (
          <div className="setup-times">
            <TimeField label="Abre às" value={lunch[0].start} onChange={(start) => setLunch([{ ...lunch[0], start }, lunch[1]])} />
            <TimeField label="Pausa às" value={lunch[0].end} onChange={(end) => setLunch([{ ...lunch[0], end }, lunch[1]])} />
            <TimeField label="Volta às" value={lunch[1].start} onChange={(start) => setLunch([lunch[0], { ...lunch[1], start }])} />
            <TimeField label="Fecha às" value={lunch[1].end} onChange={(end) => setLunch([lunch[0], { ...lunch[1], end }])} />
          </div>
        )}
        {preset === "custom" && (
          <div className="setup-per-day">
            {WEEK_ORDER.filter((d) => open[d]).map((weekday) => (
              <div key={weekday} className="setup-per-day-row">
                <strong>{WEEKDAY_LABELS[weekday]}</strong>
                <div className="min-w-0 space-y-2">
                  {perDay[weekday].map((interval, j) => (
                    <div key={j} className="setup-times">
                      <TimeField
                        label={j === 0 ? "Abre às" : "Volta às"}
                        ariaLabel={`${WEEKDAY_LABELS[weekday]} início ${j + 1}`}
                        value={interval.start}
                        onChange={(start) =>
                          setPerDay((days) =>
                            days.map((d, i) =>
                              i === weekday ? d.map((v, n) => (n === j ? { ...v, start } : v)) : d,
                            ),
                          )
                        }
                      />
                      <TimeField
                        label={j < perDay[weekday].length - 1 ? "Pausa às" : "Fecha às"}
                        ariaLabel={`${WEEKDAY_LABELS[weekday]} fim ${j + 1}`}
                        value={interval.end}
                        onChange={(end) =>
                          setPerDay((days) =>
                            days.map((d, i) =>
                              i === weekday ? d.map((v, n) => (n === j ? { ...v, end } : v)) : d,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                  <div className="setup-row-actions">
                    {perDay[weekday].length < 3 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPerDay((days) =>
                            days.map((d, i) =>
                              i === weekday ? [...d, { start: "14:00", end: "18:00" }] : d,
                            ),
                          )
                        }
                      >
                        Adicionar pausa
                      </button>
                    )}
                    {perDay[weekday].length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPerDay((days) =>
                            days.map((d, i) => (i === weekday ? d.slice(0, -1) : d)),
                          )
                        }
                      >
                        Remover último período
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </fieldset>
      <p className="setup-summary">
        <Check size={16} aria-hidden="true" />
        <span>
          {daysText}: <strong>{summary}</strong>
          <span className="block text-xs opacity-80">
            Fechamento 00:00 significa meia-noite. Fuso: {data.salon.timezone}.
          </span>
        </span>
      </p>
      {localError && (
        <p role="alert" className="setup-alert">
          {localError}
        </p>
      )}
      <div className="setup-actions">
        <button
          type="button"
          className="setup-secondary"
          disabled={pending}
          onClick={() => setScreen("days")}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Dias
        </button>
        <button type="submit" className="setup-cta" disabled={pending}>
          Salvar e continuar
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function TimeField({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="setup-time">
      {label}
      <Input
        required
        type="time"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function SetupServiceCatalog({
  services,
  run,
  pending,
  onSaved,
}: {
  services: SetupService[];
  run: Run;
  pending: boolean;
  onSaved: (next?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [editing, setEditing] = useState<SetupService | "new" | null>(null);
  const [queue, setQueue] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const reviewed = services.filter((s) => s.reviewed).length;
  const nextPending = services.find((s) => !s.reviewed);
  const filtered = services.filter(
    (service) =>
      (!onlyPending || !service.reviewed) &&
      normalizeSearch(service.name).includes(normalizeSearch(query)),
  );
  const close = () => {
    setEditing(null);
    setQueue(false);
    setDirty(false);
    setDiscard(false);
  };
  return (
    <>
      <div className="setup-spotlight">
        <div className="setup-meter" aria-hidden="true">
          <span
            style={{
              width: `${services.length ? (reviewed / services.length) * 100 : 0}%`,
            }}
          />
        </div>
        <p className="setup-meter-label">
          {services.length
            ? `${reviewed} de ${services.length} revisados`
            : "Nenhum serviço ainda"}
        </p>
        {nextPending ? (
          <div className="setup-spotlight-body">
            <div className="min-w-0">
              <p className="setup-kicker">Próximo a revisar</p>
              <strong className="block break-words text-lg">{nextPending.name}</strong>
              <span className="text-sm text-muted-foreground">
                {nextPending.durationMin} min · {formatMoney(nextPending.priceCents)}
              </span>
            </div>
            <button
              type="button"
              className="setup-cta"
              disabled={pending}
              onClick={() => {
                setQueue(true);
                setEditing(nextPending);
              }}
            >
              Revisar um por vez
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="setup-spotlight-body">
            <p className="text-sm">
              {services.length
                ? "Tudo revisado. Adicione outro serviço quando quiser."
                : "Comece pelo seu serviço principal: nome, duração e preço."}
            </p>
            <button
              type="button"
              className={services.length ? "setup-secondary" : "setup-cta"}
              disabled={pending}
              onClick={() => setEditing("new")}
            >
              <Plus size={16} aria-hidden="true" />
              {services.length ? "Novo serviço" : "Adicionar primeiro serviço"}
            </button>
          </div>
        )}
      </div>
      {services.length > 0 && (
        <div className="setup-card space-y-3">
          <div className="setup-card-head">
            <h2 className="setup-card-title">Todos os serviços</h2>
            {nextPending && (
              <button
                type="button"
                className="setup-secondary"
                disabled={pending}
                onClick={() => setEditing("new")}
              >
                <Plus size={16} aria-hidden="true" />
                Novo serviço
              </button>
            )}
          </div>
          <label className="setup-search">
            <Search size={18} aria-hidden className="text-muted-foreground" />
            <span className="sr-only">Pesquisar serviços</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar pelo nome do serviço"
            />
          </label>
          <div className="setup-quick" role="group" aria-label="Filtrar revisão de serviços">
            {[
              [false, "Todos"],
              [true, "A revisar"],
            ].map(([filter, label]) => (
              <button
                key={String(label)}
                type="button"
                aria-pressed={onlyPending === filter}
                onClick={() => setOnlyPending(Boolean(filter))}
              >
                {label}
              </button>
            ))}
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {filtered.length} serviços. Toque para revisar preço e duração.
          </p>
          <div className="setup-service-list" role="group" aria-label="Lista de serviços">
            {filtered.map((service) => (
              <button
                type="button"
                disabled={pending}
                key={service.id}
                onClick={() => setEditing(service)}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block break-words text-sm font-medium">
                    {service.name}
                  </strong>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {service.durationMin} min · {formatMoney(service.priceCents)}
                  </span>
                  <span className="setup-service-state" data-done={service.reviewed || undefined}>
                    {service.reviewed ? "Serviço revisado" : "Revisar preço e duração"}
                  </span>
                </span>
                <ChevronRight size={18} aria-hidden className="shrink-0 text-muted-foreground" />
              </button>
            ))}
            {!filtered.length && (
              <p className="p-5 text-sm text-muted-foreground">
                Nenhum serviço neste filtro. Limpe a busca ou escolha Todos.
              </p>
            )}
          </div>
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            if (dirty) setDiscard(true);
            else close();
          }
        }}
      >
        <DialogContent
          mobileSheet
          aria-describedby="setup-service-description"
          className="setup-dialog p-4 pt-6 sm:p-6"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogTitle className="pr-10 text-xl">
            {editing === "new" ? "Novo serviço" : "Revisar serviço"}
          </DialogTitle>
          <DialogDescription id="setup-service-description">
            {queue && editing && editing !== "new"
              ? `Serviço ${services.findIndex((s) => s.id === editing.id) + 1} de ${services.length}. Confira os dados que seu cliente verá.`
              : "Confira os dados que seu cliente verá ao agendar."}
          </DialogDescription>
          {editing && (
            <div onChange={() => setDirty(true)}>
              <ServiceEditor
                key={editing === "new" ? "new" : editing.id}
                service={editing === "new" ? undefined : editing}
                queue={queue}
                run={run}
                pending={pending}
                onSaved={() => {
                  const current = editing === "new" ? null : editing.id;
                  const next = queue
                    ? services.find((s) => !s.reviewed && s.id !== current)
                    : undefined;
                  setDirty(false);
                  setDiscard(false);
                  if (next) setEditing(next);
                  else close();
                  onSaved(next?.name);
                }}
              />
            </div>
          )}
          {discard && (
            <div role="alert" className="space-y-2 rounded-xl border border-border p-3 text-sm">
              <p>Você tem alterações não salvas.</p>
              <Button disabled={pending} variant="outline" onClick={() => setDiscard(false)}>
                Continuar editando
              </Button>
              <Button disabled={pending} variant="ghost" onClick={close}>
                Descartar alterações
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ServiceEditor({
  service,
  queue,
  run,
  pending,
  onSaved,
}: {
  service?: SetupService;
  queue: boolean;
  run: Run;
  pending: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(service?.name ?? "");
  const [duration, setDuration] = useState(String(service?.durationMin ?? 60));
  const [price, setPrice] = useState(
    service ? (service.priceCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [free, setFree] = useState(
    (service?.reviewed && service.priceCents === 0) || false,
  );
  const [saveError, setSaveError] = useState("");
  const priceCents = Math.round(Number(price.replace(",", ".")) * 100);
  return (
    <form
      className="setup-service-editor"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          setSaveError("");
          try {
            await saveSetupService({
              id: service?.id,
              name,
              durationMin: Number(duration),
              priceCents,
              freeConfirmed: free,
            });
            onSaved();
          } catch (error) {
            setSaveError(
              error instanceof Error
                ? error.message
                : "Não foi possível salvar. Tente novamente.",
            );
          }
        });
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {service ? "Revise este serviço" : "Adicionar serviço"}
        </legend>
        <label className="block text-sm">
          Nome do serviço
          <Input
            name="name"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Reflexologia podal"
          />
        </label>
        <div>
          <span className="text-sm" id="duration-options">
            Quanto tempo leva?
          </span>
          <div className="setup-durations" role="group" aria-labelledby="duration-options">
            {DURATIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={Number(duration) === value}
                onClick={() => setDuration(String(value))}
              >
                {value} min
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Duração (min)
            <Input
              name="duration"
              required
              type="number"
              min={5}
              max={600}
              step={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Preço (R$)
            <Input
              name="price"
              required
              inputMode="decimal"
              pattern="[0-9]+([.,][0-9]{1,2})?"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0,00"
            />
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0"
            checked={free}
            onChange={(e) => setFree(e.target.checked)}
          />
          Se o preço for zero, confirmo que este serviço é gratuito.
        </label>
        <div className="setup-client-preview" role="group" aria-label="Como o cliente vê">
          <span className="setup-client-preview-label">Como o cliente vê</span>
          <div>
            <strong>{name.trim() || "Nome do serviço"}</strong>
            <span>{Number(duration) > 0 ? `${Number(duration)} min` : "—"}</span>
          </div>
          <strong>
            {Number.isFinite(priceCents) && price.trim()
              ? priceCents === 0
                ? free
                  ? "Gratuito"
                  : "Defina o preço"
                : formatMoney(priceCents)
              : "Defina o preço"}
          </strong>
        </div>
        {saveError && (
          <p role="alert" className="text-sm text-danger">
            {saveError}
          </p>
        )}
        <button type="submit" className="setup-cta w-full">
          {pending
            ? "Salvando…"
            : service
              ? queue
                ? "Salvar e ir para o próximo"
                : "Salvar serviço"
              : "Adicionar serviço"}
        </button>
      </fieldset>
    </form>
  );
}

function ProfessionalEditor({
  pro,
  data,
  run,
  pending,
  onSaved,
}: {
  pro: SetupProfessional;
  data: SetupData;
  run: Run;
  pending: boolean;
  onSaved: () => void;
}) {
  const fresh = pro.serviceIds.length === 0 && pro.hours.length === 0;
  // Primeira configuração guiada: já sugere todos os serviços e os horários
  // da etapa 1. Nada é gravado até a confirmação explícita.
  const [ids, setIds] = useState(
    fresh ? data.services.map((s) => s.id) : pro.serviceIds,
  );
  const [apply, setApply] = useState(fresh && data.hoursConfirmed);
  const isSelf = pro.userId === data.userId;
  return (
    <form
      className="setup-card"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await saveSetupProfessional({
            id: pro.id,
            serviceIds: ids,
            applyHours: apply,
          });
          onSaved();
        });
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="setup-person">
          <span className="setup-avatar" aria-hidden="true">
            {pro.name.trim().charAt(0).toUpperCase()}
          </span>
          <span>
            <strong>{pro.name}</strong>
            <span>{isSelf ? "Sua agenda" : "Agenda da equipe"}</span>
          </span>
        </legend>
        <p className="text-sm font-medium">Quais serviços essa pessoa realiza?</p>
        {data.services.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Adicione um serviço no passo anterior.
          </p>
        )}
        <div className="setup-service-checks">
          {data.services.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={ids.includes(s.id)}
                disabled={pro.serviceIds.includes(s.id)}
                onChange={(e) =>
                  setIds((current) =>
                    e.target.checked
                      ? [...current, s.id]
                      : current.filter((id) => id !== s.id),
                  )
                }
              />
              {s.name}
            </label>
          ))}
        </div>
        {pro.hours.length ? (
          <div className="text-sm">
            <p className="mb-1 font-medium">Jornada já configurada</p>
            <p className="text-xs text-muted-foreground">
              Os horários existentes serão mantidos.
            </p>
            <div className="mt-2">
              <WorkingHoursForm
                professionalId={pro.id}
                professionalName={pro.name}
                current={pro.hours}
                salonHours={data.salon}
              />
            </div>
          </div>
        ) : (
          <>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={apply}
                disabled={!data.hoursConfirmed}
                onChange={(e) => setApply(e.target.checked)}
              />
              Usar os horários da primeira etapa nesta agenda
            </label>
            {!data.hoursConfirmed && (
              <p className="text-sm text-muted-foreground">
                Primeiro salve os horários de atendimento.
              </p>
            )}
            {apply && (
              <ul className="setup-hours-list">
                {WEEK_ORDER.map((i) => (
                  <li key={i}>
                    <span>{WEEKDAY_LABELS[i]}</span>
                    <span>{scheduleLabel(data.hours, i)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <button
          type="submit"
          className="setup-cta"
          disabled={!ids.length}
        >
          Salvar profissional
        </button>
      </fieldset>
    </form>
  );
}

function AppPreview({ data }: { data: SetupData }) {
  const services = data.services.slice(0, 3);
  const openDays = WEEK_ORDER.filter((d) => data.hours.some((h) => h.weekday === d));
  return (
    <div className="setup-app-preview" role="group" aria-label="Prévia do aplicativo do cliente">
      <div className="setup-app-cover">
        <strong>{data.salon.name}</strong>
      </div>
      <div className="setup-app-body">
        {services.length ? (
          services.map((s) => (
            <div key={s.id} className="setup-app-row">
              <span>
                {s.name} · {s.durationMin} min
              </span>
              <strong>
                {!s.reviewed
                  ? "A revisar"
                  : s.priceCents
                    ? formatMoney(s.priceCents)
                    : "Gratuito"}
              </strong>
            </div>
          ))
        ) : (
          <p>Seus serviços aparecem aqui.</p>
        )}
        <p className="setup-app-hours">
          {openDays.length
            ? `Atende: ${openDays.map((d) => WEEKDAY_LABELS[d].slice(0, 3)).join(", ")}`
            : "Defina seus horários para liberar a agenda."}
        </p>
      </div>
    </div>
  );
}

function ContactEditor({
  data,
  run,
  pending,
  onSaved,
}: {
  data: SetupData;
  run: Run;
  pending: boolean;
  onSaved: () => void;
}) {
  return (
    <form
      className="setup-card"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(async () => {
          await saveSetupContact({
            address: String(f.get("address")),
            phone: String(f.get("phone")),
          });
          onSaved();
        });
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="setup-card-title">Como o cliente encontra você</legend>
        <label className="block text-sm">
          Endereço
          <Input
            name="address"
            autoComplete="street-address"
            maxLength={300}
            defaultValue={data.salon.address ?? ""}
            placeholder="Rua, número e bairro"
          />
        </label>
        <label className="block text-sm">
          Telefone com DDD
          <Input
            name="phone"
            type="tel"
            autoComplete="tel"
            defaultValue={data.salon.phone ?? ""}
            placeholder="(11) 99999-9999"
          />
        </label>
        <button type="submit" className="setup-secondary">
          Salvar contato
        </button>
      </fieldset>
    </form>
  );
}
