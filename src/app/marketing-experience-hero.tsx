"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBusinessExperience } from "@/config/business-experience";
import {
  DEFAULT_SEGMENT_ID,
  SEGMENTS,
  getSegment,
  type SegmentId,
} from "@/lib/segments";

type SegmentStory = {
  eyebrow: string;
  headline: string;
  accentLine: string;
  description: string;
  businessName: string;
};

const SEGMENT_STORIES: Record<SegmentId, SegmentStory> = {
  barbearia: {
    eyebrow: "Feito para o ritmo da barbearia",
    headline: "Sua barbearia no ritmo certo.",
    accentLine: "Da reserva ao fechamento.",
    description:
      "Organize barbeiros, cortes, combos e retornos sem perder tempo entre um cliente e outro.",
    businessName: "Barbearia Central",
  },
  "salao-beleza": {
    eyebrow: "Feito para equipes de salão",
    headline: "Seu salão em harmonia.",
    accentLine: "Da recepção ao último atendimento.",
    description:
      "Conecte agenda, profissionais, serviços longos e histórico de clientes em uma rotina mais leve.",
    businessName: "Ateliê Aurora",
  },
  "manicure-nail": {
    eyebrow: "Feito para manicure e nail designer",
    headline: "Uma agenda tão bem cuidada",
    accentLine: "quanto cada detalhe do seu trabalho.",
    description:
      "Visualize manutenções, procedimentos recorrentes e preferências sem procurar informação em conversas antigas.",
    businessName: "Studio Bela",
  },
  "estetica-bemestar": {
    eyebrow: "Feito para estética e bem-estar",
    headline: "Mais calma para atender.",
    accentLine: "Mais clareza para crescer.",
    description:
      "Acompanhe sessões, pacotes, intervalos e frequência com uma visão organizada e acolhedora.",
    businessName: "Essência Bem-estar",
  },
  "espaco-misto": {
    eyebrow: "Feito para espaços multiespecialidade",
    headline: "Especialidades diferentes.",
    accentLine: "Uma operação que funciona como uma só.",
    description:
      "Reúna cabelo, unhas, estética e outros serviços sem dividir sua equipe, seus clientes ou seus resultados.",
    businessName: "Espaço Plural",
  },
};

const APPOINTMENT_TIMES = ["09:00", "10:30", "13:00"] as const;

export function MarketingExperienceHero({
  selectedId,
  onSelect,
}: {
  selectedId: SegmentId;
  onSelect: (segmentId: SegmentId) => void;
}) {
  const selected = getSegment(selectedId);
  const experience = getBusinessExperience(selectedId);
  const story = SEGMENT_STORIES[selectedId];
  const appointments = selected.exampleServices.slice(0, APPOINTMENT_TIMES.length);

  return (
    <section
      data-business-experience={selectedId}
      data-experience-direction={experience.visual.direction}
      data-experience-density={experience.visual.density}
      className="experience-scope marketing-experience-hero relative overflow-hidden pb-20 pt-28 sm:pt-32 lg:pb-28 lg:pt-36"
    >
      <div className="container relative z-10">
        <div className="mb-10 lg:mb-12">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Veja o SalonSaaS para o seu negócio
          </p>
          <div
            className="marketing-segment-switcher grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card/75 p-2 shadow-premium backdrop-blur-xl sm:grid-cols-5"
            aria-label="Escolha um tipo de estabelecimento para personalizar a demonstração"
          >
            {SEGMENTS.map((segment) => {
              const active = segment.id === selectedId;
              const Icon = segment.icon;

              return (
                <button
                  key={segment.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(segment.id)}
                  className={`group relative flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background last:col-span-2 sm:last:col-span-1 ${
                    active
                      ? "marketing-segment-active"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-card-hover hover:text-foreground"
                  }`}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span>{segment.shortLabel}</span>
                  {active && (
                    <CheckCircle2
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <p className="sr-only" aria-live="polite">
            Demonstração atualizada para {selected.label}.
          </p>
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-[0.88fr_1.12fr] lg:gap-14">
          <div key={`copy-${selectedId}`} className="animate-fade-in">
            <div className="experience-icon-surface mb-6 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              {story.eyebrow}
            </div>

            <h1 className="max-w-2xl font-display text-[2.65rem] leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-[4.25rem]">
              {story.headline}
              <span className="experience-accent-text mt-1 block">
                {story.accentLine}
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              {story.description}
            </p>

            <div className="mt-7 grid max-w-xl gap-3 text-sm text-foreground/90 sm:grid-cols-3">
              <HeroBenefit icon={CalendarDays} label="Agenda sem conflito" />
              <HeroBenefit icon={UsersRound} label={`Visão dos ${experience.terminology.professionals}`} />
              <HeroBenefit icon={Bell} label="Atualização em um só lugar" />
            </div>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="h-14 rounded-full px-8 text-base">
                <Link href="/signup">
                  Criar conta grátis <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-14 rounded-full border-border bg-card/60 px-8 text-base backdrop-blur hover:bg-card-hover"
              >
                <Link href="/book/north-barber">
                  Abrir demonstração <ExternalLink aria-hidden="true" className="h-4 w-4" />
                </Link>
              </Button>
            </div>

            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Check aria-hidden="true" className="experience-accent-text h-4 w-4" />
              Sem cartão de crédito para começar.
            </p>
          </div>

          <ExperiencePreview
            key={`preview-${selectedId}`}
            selectedId={selectedId}
            image={selected.accentImage}
            imageAlt={`Ambiente de ${selected.label.toLowerCase()}`}
            objectPosition={experience.imagery.objectPosition}
            businessName={story.businessName}
            segmentLabel={selected.shortLabel}
            professionalLabel={experience.terminology.professional}
            appointments={appointments}
          />
        </div>
      </div>
    </section>
  );
}

function HeroBenefit({
  icon: Icon,
  label,
}: {
  icon: typeof CalendarDays;
  label: string;
}) {
  return (
    <div className="marketing-quiet-surface flex min-h-12 items-center gap-2.5 rounded-xl border border-border bg-card/55 px-3 py-2">
      <Icon aria-hidden="true" className="experience-accent-text h-4 w-4 shrink-0" />
      <span className="leading-5">{label}</span>
    </div>
  );
}

function ExperiencePreview({
  selectedId,
  image,
  imageAlt,
  objectPosition,
  businessName,
  segmentLabel,
  professionalLabel,
  appointments,
}: {
  selectedId: SegmentId;
  image: string;
  imageAlt: string;
  objectPosition: string;
  businessName: string;
  segmentLabel: string;
  professionalLabel: string;
  appointments: { name: string; durationMin: number }[];
}) {
  return (
    <div className="marketing-preview-frame animate-slide-up overflow-hidden rounded-[1.75rem] border bg-card shadow-2xl sm:rounded-[2rem]">
      <div className="relative h-60 overflow-hidden sm:h-72">
        <Image
          src={image}
          alt={imageAlt}
          fill
          priority={selectedId === DEFAULT_SEGMENT_ID}
          sizes="(max-width: 1023px) 100vw, 58vw"
          className="object-cover"
          style={{ objectPosition }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-black/25 to-black/15" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 sm:p-5">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/80" />
          </div>
          <span className="rounded-full border border-white/20 bg-black/35 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-md">
            Prévia ilustrativa
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-10 px-5 sm:px-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
            Experiência {segmentLabel}
          </p>
          <p className="mt-1 font-display text-2xl text-white sm:text-3xl">{businessName}</p>
        </div>
      </div>

      <div className="relative -mt-8 p-3 pt-0 sm:-mt-10 sm:p-5 sm:pt-0">
        <div className="rounded-2xl border border-border bg-background/95 p-4 shadow-premium backdrop-blur-xl sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Agenda de hoje</p>
              <h2 className="mt-1 text-base font-semibold sm:text-lg">Próximos atendimentos</h2>
            </div>
            <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card">
              <Bell aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <span className="marketing-notification-dot absolute right-2 top-2 h-2 w-2 rounded-full" />
              <span className="sr-only">Há uma nova notificação</span>
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[0.72fr_1.28fr]">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
              <PreviewStatus icon={CalendarDays} title="Agenda online" value="Disponível" />
              <PreviewStatus icon={UsersRound} title="Equipe" value="Organizada" />
            </div>

            <div className="rounded-xl border border-border bg-card/60 px-3.5">
              {appointments.map((appointment, index) => (
                <div
                  key={appointment.name}
                  className="flex min-h-14 items-center gap-3 border-b border-border/70 py-2.5 last:border-0"
                >
                  <span className="experience-accent-text w-11 shrink-0 text-xs font-bold tabular-nums">
                    {APPOINTMENT_TIMES[index]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium leading-4 text-foreground">
                      {appointment.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] leading-4 text-muted-foreground">
                      <Clock3 aria-hidden="true" className="h-3 w-3" />
                      {appointment.durationMin} min · {professionalLabel} {index + 1}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewStatus({
  icon: Icon,
  title,
  value,
}: {
  icon: typeof CalendarDays;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <Icon aria-hidden="true" className="experience-accent-text mb-2 h-4 w-4" />
      <p className="text-[10px] leading-4 text-muted-foreground">{title}</p>
      <p className="text-xs font-semibold leading-5 text-foreground">{value}</p>
    </div>
  );
}
