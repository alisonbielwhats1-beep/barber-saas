"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Scissors,
  Smartphone,
  Users,
} from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const steps = [
  { title: "Horários", detail: "Quando seu espaço atende", icon: Clock3 },
  { title: "Serviços", detail: "O que o cliente pode agendar", icon: Scissors },
  { title: "Profissionais", detail: "Quem realiza cada serviço", icon: Users },
  {
    title: "Aplicativo do cliente",
    detail: "Confira e compartilhe seu link",
    icon: Smartphone,
  },
];
const titles = [
  "Vamos começar pelos horários.",
  "O que você oferece?",
  "Quem vai atender?",
  "Seu aplicativo para clientes.",
];
const descriptions = [
  "Escolha os dias e períodos de atendimento. Depois, você poderá usar esses horários na agenda de cada profissional.",
  "Confira os serviços sugeridos ou adicione os seus. O preço e a duração aparecem para o cliente ao agendar.",
  "Associe os serviços a quem os realiza e confira a jornada. Se você também atende, pode usar sua própria conta.",
  "Este é o link que você entrega aos clientes. Ele abre sua página de agendamento no celular ou no computador.",
];
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
  const [refreshing, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pending = saving || refreshing;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const checks = setupChecks(data);
  const ready = checks.slice(0, 3).every(Boolean);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
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
  return (
    <ThemeProvider>
      <div className="setup-shell">
        <header className="setup-header">
          <BrandLogo className="!h-9 !w-[142px]" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" disabled={pending} onClick={leave}>
              Fazer depois
            </Button>
          </div>
        </header>
        <div className="setup-layout">
          <aside className="setup-sidebar">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Configuração inicial
            </p>
            <p className="mt-2 break-words text-lg font-semibold">
              {data.salon.name}
            </p>
            <nav aria-label="Etapas de configuração">
              <ol className="setup-steps">
                {steps.map((item, i) => (
                  <li key={item.title}>
                    <button
                      disabled={pending}
                      aria-label={`${i + 1}. ${item.title}`}
                      aria-current={step === i ? "step" : undefined}
                      className="setup-step"
                      onClick={() => run(() => move(i))}
                    >
                      <span className="setup-step-number">
                        {checks[i] ? (
                          <Check size={18} aria-hidden="true" />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className="setup-step-copy">
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </span>
                      <span className="sr-only">
                        {checks[i] ? "Concluído" : "Pendente"}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <p className="setup-sidebar-note">
              No seu ritmo. Você pode sair agora e retomar em{" "}
              <strong>Painel → Continuar configuração</strong>.
            </p>
          </aside>
          <main id="main-content" className="setup-main" tabIndex={-1}>
            <div className="mb-7">
              <p className="mb-3 text-sm text-muted-foreground">
                Etapa {step + 1} de 4 · {steps[step].title}
              </p>
              <h1 ref={heading} tabIndex={-1} className="setup-title">
                {titles[step]}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {descriptions[step]}
              </p>
            </div>
            <div
              className="mb-6 h-1 rounded-full bg-muted"
              role="progressbar"
              aria-label="Etapas concluídas"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={checks.filter(Boolean).length}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${checks.filter(Boolean).length * 25}%` }}
              />
            </div>
            {error && (
              <p
                role="alert"
                className="mb-5 rounded-xl border border-destructive/40 p-4 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <p
              role="status"
              className={message ? "mb-4 text-sm text-primary" : "sr-only"}
            >
              {message}
            </p>
            {step === 0 && (
              <HoursStep
                key={JSON.stringify(data.hours)}
                data={data}
                pending={pending}
                onSave={(hours) =>
                  run(async () => {
                    await saveSetupHours(hours);
                    await move(1);
                  })
                }
              />
            )}
            {step === 1 && (
              <section aria-label="Seus serviços" className="space-y-4">
                {data.services.map((service) => (
                  <ServiceEditor
                    key={`${service.id}-${service.name}-${service.priceCents}-${service.durationMin}`}
                    service={service}
                    run={run}
                    pending={pending}
                    onSaved={() =>
                      setMessage(
                        "Serviço salvo. Você pode adicionar outro ou continuar.",
                      )
                    }
                  />
                ))}
                <ServiceEditor
                  key={`new-${data.services.length}`}
                  run={run}
                  pending={pending}
                  onSaved={() =>
                    setMessage(
                      "Serviço adicionado. Agora associe um profissional a ele.",
                    )
                  }
                />
                <Button
                  disabled={pending}
                  className="w-full sm:w-auto"
                  onClick={() => run(() => move(2))}
                >
                  Continuar para profissionais
                  <ArrowRight size={16} />
                </Button>
              </section>
            )}
            {step === 2 && (
              <section aria-label="Sua equipe" className="space-y-5">
                {canCreateSelf &&
                  !data.professionals.some((p) => p.userId === data.userId) && (
                    <div className="setup-panel">
                      <h2 className="font-semibold">Você também atende?</h2>
                      <p className="my-3 text-sm text-muted-foreground">
                        Crie uma agenda para {data.userName}, usando a conta com
                        que você entrou.
                      </p>
                      <Button
                        disabled={pending}
                        onClick={() => run(enableMySetupAgenda)}
                      >
                        Eu mesmo atendo
                      </Button>
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
                        "Profissional configurado. Confira a próxima pessoa ou continue.",
                      )
                    }
                  />
                ))}
                <div className="setup-panel">
                  <h2 className="font-semibold">Mais pessoas na equipe</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    O cadastro e os convites ficam em Profissionais. Quando uma
                    pessoa estiver ativa, ela aparecerá aqui para configurar
                    seus serviços e horários.
                  </p>
                  <Link
                    href="/profissionais"
                    className="setup-link"
                    onClick={(e) => {
                      e.preventDefault();
                      run(async () => {
                        await saveSetupProgress({
                          step: 2,
                          status: "deferred",
                        });
                        router.push("/profissionais");
                      });
                    }}
                  >
                    Gerenciar profissionais
                    <ArrowRight size={16} />
                  </Link>
                </div>
                <Button
                  disabled={pending}
                  className="w-full sm:w-auto"
                  onClick={() => run(() => move(3))}
                >
                  Conhecer o aplicativo do cliente
                  <ArrowRight size={16} />
                </Button>
              </section>
            )}
            {step === 3 && (
              <section
                className="space-y-6"
                aria-label="Aplicativo e compartilhamento"
              >
                <div className="setup-booking">
                  <Smartphone size={28} aria-hidden="true" />
                  <div>
                    <h2 className="font-semibold">
                      O link do seu estabelecimento
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Use no WhatsApp, na bio do Instagram e nas suas redes
                      sociais.
                    </p>
                  </div>
                  <label
                    className="col-span-full text-sm"
                    htmlFor="booking-link"
                  >
                    Link do aplicativo do cliente
                  </label>
                  <Input
                    id="booking-link"
                    className="col-span-full !text-base"
                    readOnly
                    value={bookingUrl}
                    onFocus={(e) => e.target.select()}
                  />
                  <div className="col-span-full grid gap-3 sm:grid-cols-2">
                    <Button
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
                      <Copy size={16} />
                      Copiar link
                    </Button>
                    <a
                      href={bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="setup-outline"
                    >
                      Abrir aplicativo
                      <ExternalLink size={16} />
                      <span className="sr-only">em nova aba</span>
                    </a>
                  </div>
                </div>
                <div className="setup-panel">
                  <h2 className="font-semibold">Como seu cliente usa</h2>
                  <ol className="setup-explainer">
                    <li>
                      <span>1</span>Abre seu link, conhece o espaço e escolhe os
                      serviços.
                    </li>
                    <li>
                      <span>2</span>Escolhe o profissional, o dia e um horário
                      disponível.
                    </li>
                    <li>
                      <span>3</span>Entra ou cria uma conta para confirmar. A
                      reserva aparece na sua agenda.
                    </li>
                  </ol>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    O aplicativo funciona pelo navegador. A instalação no
                    celular é opcional; o cliente pode usar a opção de adicionar
                    à tela inicial quando disponível.
                  </p>
                </div>
                <ContactEditor
                  key={`${data.salon.address}-${data.salon.phone}`}
                  data={data}
                  run={run}
                  pending={pending}
                  onSaved={() => setMessage("Dados de contato salvos.")}
                />
                <div className="setup-panel">
                  <h2 className="font-semibold">Onde encontrar depois</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    No computador, abra <strong>Compartilhar</strong> no menu
                    lateral. No celular, toque em{" "}
                    <strong>Mais → Compartilhar</strong>. Lá você encontra
                    novamente o link e o QR Code.
                  </p>
                  <Link
                    href="/compartilhar"
                    className="setup-link"
                    onClick={(e) => {
                      e.preventDefault();
                      run(async () => {
                        await saveSetupProgress({
                          step: 3,
                          status: "deferred",
                        });
                        router.push("/compartilhar");
                      });
                    }}
                  >
                    Ver página de compartilhamento
                    <ArrowRight size={16} />
                  </Link>
                </div>
                <div className="setup-panel">
                  <h2 className="font-semibold">
                    {ready
                      ? "Configuração essencial pronta"
                      : "Antes de divulgar, confira"}
                  </h2>
                  <ul className="mt-3 space-y-3">
                    {[
                      "Horários de atendimento definidos",
                      "Serviços com preço e duração revisados",
                      "Cada serviço com profissional e jornada compatível",
                    ].map((label, i) => (
                      <li
                        key={label}
                        className="flex items-start gap-2 text-sm"
                      >
                        {checks[i] ? (
                          <Check
                            className="mt-0.5 shrink-0 text-primary"
                            size={16}
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-muted-foreground" />
                        )}
                        <button
                          className="text-left underline-offset-4 hover:underline"
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
                  <p className="mt-4 text-sm text-muted-foreground">
                    {ready
                      ? "A disponibilidade também considera reservas, pausas, folgas e bloqueios. Abra o aplicativo e confira os horários antes de divulgar."
                      : "Você já pode conhecer o aplicativo. Complete os itens pendentes para que o cliente encontre serviços e horários para agendar."}
                  </p>
                </div>
                <Button
                  disabled={pending}
                  className="w-full sm:w-auto"
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
                  {ready
                    ? "Concluir configuração"
                    : "Continuar depois no painel"}
                  <ArrowRight size={16} />
                </Button>
              </section>
            )}
            <footer className="setup-footer">
              {step > 0 && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => move(step - 1))}
                >
                  <ArrowLeft size={16} />
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
              <span className="text-xs text-muted-foreground">
                {pending
                  ? "Salvando…"
                  : "Cada etapa salva fica disponível quando você voltar."}
              </span>
            </footer>
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}

function HoursStep({
  data,
  pending,
  onSave,
}: {
  data: SetupData;
  pending: boolean;
  onSave: (hours: WeeklyHours[]) => void;
}) {
  const [days, setDays] = useState(() =>
    WEEKDAY_LABELS.map((_, weekday) => ({
      enabled: data.hours.length
        ? data.hours.some((h) => h.weekday === weekday)
        : weekday > 0,
      intervals: (data.hours.filter((h) => h.weekday === weekday).length
        ? data.hours.filter((h) => h.weekday === weekday)
        : [
            {
              startMinutes: data.salon.openMinutes,
              endMinutes: data.salon.closeMinutes,
            },
          ]
      ).map((h) => ({
        start: scheduleTime(h.startMinutes),
        end: h.endMinutes === 1440 ? "00:00" : scheduleTime(h.endMinutes),
      })),
    })),
  );
  function update(i: number, change: Partial<(typeof days)[number]>) {
    setDays((current) =>
      current.map((d, index) => (index === i ? { ...d, ...change } : d)),
    );
  }
  const minutes = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(
          days.flatMap((d, weekday) =>
            d.enabled
              ? d.intervals.map((i) => ({
                  weekday,
                  startMinutes: minutes(i.start),
                  endMinutes: i.end === "00:00" ? 1440 : minutes(i.end),
                }))
              : [],
          ),
        );
      }}
    >
      <fieldset disabled={pending} className="space-y-3">
        <legend className="sr-only">Dias e períodos de atendimento</legend>
        {days.map((day, i) => (
          <div className="setup-day" key={i}>
            <label className="flex min-h-11 items-center gap-3 font-medium">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--action-positive)]"
                checked={day.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
              />
              {WEEKDAY_LABELS[i]}
            </label>
            {!day.enabled ? (
              <span className="text-sm text-muted-foreground">Fechado</span>
            ) : (
              <div className="min-w-0 space-y-3">
                {day.intervals.map((interval, j) => (
                  <div key={j} className="grid grid-cols-2 gap-3">
                    <label className="min-w-0 text-xs text-muted-foreground">
                      {j === 0 ? "Abre às" : "Retorna às"}
                      <Input
                        required
                        type="time"
                        aria-label={`${WEEKDAY_LABELS[i]} início ${j + 1}`}
                        value={interval.start}
                        onChange={(e) =>
                          update(i, {
                            intervals: day.intervals.map((v, n) =>
                              n === j ? { ...v, start: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="min-w-0 text-xs text-muted-foreground">
                      {j < day.intervals.length - 1 ? "Pausa às" : "Fecha às"}
                      <Input
                        required
                        type="time"
                        aria-label={`${WEEKDAY_LABELS[i]} fim ${j + 1}`}
                        value={interval.end}
                        onChange={(e) =>
                          update(i, {
                            intervals: day.intervals.map((v, n) =>
                              n === j ? { ...v, end: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </label>
                    {j > 0 && (
                      <button
                        type="button"
                        className="col-span-2 min-h-11 text-left text-xs underline"
                        onClick={() =>
                          update(i, {
                            intervals: day.intervals.filter((_, n) => n !== j),
                          })
                        }
                      >
                        Remover período {j + 1}
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex flex-wrap gap-x-4">
                  <button
                    type="button"
                    className="min-h-11 text-xs underline"
                    onClick={() =>
                      update(i, {
                        intervals: [
                          ...day.intervals,
                          { start: "14:00", end: "18:00" },
                        ],
                      })
                    }
                  >
                    Adicionar período / pausa
                  </button>
                  <button
                    type="button"
                    className="min-h-11 text-left text-xs underline"
                    onClick={() =>
                      setDays((current) =>
                        current.map((d) =>
                          d.enabled
                            ? {
                                ...d,
                                intervals: day.intervals.map((v) => ({ ...v })),
                              }
                            : d,
                        ),
                      )
                    }
                  >
                    Copiar para os dias abertos
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <p className="py-2 text-xs leading-relaxed text-muted-foreground">
          Para uma pausa, use dois períodos: por exemplo, 09:00–12:00 e
          13:00–18:00. Fechamento 00:00 significa meia-noite. Fuso:{" "}
          {data.salon.timezone}. Horários individuais já cadastrados serão
          preservados.
        </p>
        <Button type="submit" className="w-full sm:w-auto">
          Salvar e continuar
          <ArrowRight size={16} />
        </Button>
      </fieldset>
    </form>
  );
}

function ServiceEditor({
  service,
  run,
  pending,
  onSaved,
}: {
  service?: SetupService;
  run: Run;
  pending: boolean;
  onSaved: () => void;
}) {
  const [free, setFree] = useState(
    (service?.reviewed && service.priceCents === 0) || false,
  );
  return (
    <form
      className="setup-panel"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(async () => {
          await saveSetupService({
            id: service?.id,
            name: String(f.get("name")),
            durationMin: Number(f.get("duration")),
            priceCents: Math.round(
              Number(String(f.get("price")).replace(",", ".")) * 100,
            ),
            freeConfirmed: free,
          });
          onSaved();
        });
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="mb-3 font-semibold">
          {service
            ? service.reviewed
              ? "Serviço revisado"
              : "Revise este serviço"
            : "Adicionar serviço"}
        </legend>
        <label className="block text-sm">
          Nome do serviço
          <Input
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={service?.name}
            placeholder="Ex.: Corte de cabelo"
          />
        </label>
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
              defaultValue={service?.durationMin ?? 30}
            />
          </label>
          <label className="text-sm">
            Preço (R$)
            <Input
              name="price"
              required
              inputMode="decimal"
              pattern="[0-9]+([.,][0-9]{1,2})?"
              defaultValue={
                service
                  ? (service.priceCents / 100).toFixed(2).replace(".", ",")
                  : ""
              }
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
        <Button type="submit" variant="outline" className="w-full sm:w-auto">
          {service ? "Salvar serviço" : "Adicionar serviço"}
        </Button>
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
  const [ids, setIds] = useState(pro.serviceIds);
  const [apply, setApply] = useState(false);
  return (
    <form
      className="setup-panel"
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
        <legend className="mb-2 font-semibold">{pro.name}</legend>
        <p className="text-sm text-muted-foreground">
          Quais serviços essa pessoa realiza?
        </p>
        {data.services.length === 0 && (
          <p className="text-sm">Adicione um serviço na etapa anterior.</p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {data.services.map((s) => (
            <label
              key={s.id}
              className="flex min-h-11 items-center gap-3 text-sm"
            >
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
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
            <p className="mb-2 font-medium">Jornada já configurada</p>
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
              <ul className="space-y-1 rounded-xl bg-muted p-3 text-xs">
                {WEEKDAY_LABELS.map((label, i) => (
                  <li key={label}>
                    {label}: {scheduleLabel(data.hours, i)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Button
          type="submit"
          disabled={!ids.length}
          variant="outline"
          className="w-full sm:w-auto"
        >
          Salvar profissional
        </Button>
      </fieldset>
    </form>
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
      className="setup-panel"
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
        <legend className="mb-2 font-semibold">
          Como o cliente encontra você
        </legend>
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
        <Button type="submit" variant="outline">
          Salvar contato
        </Button>
      </fieldset>
    </form>
  );
}
