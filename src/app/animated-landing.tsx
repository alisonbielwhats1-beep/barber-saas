"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  LayoutDashboard,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SegmentKey = "todos" | "barbearia" | "salao" | "bem-estar";

type Segment = {
  key: SegmentKey;
  label: string;
  eyebrow: string;
  theme: string;
  photos: { src: string; alt: string; label?: string; position?: string }[];
  appointments: string[];
};

const SEGMENTS: Segment[] = [
  {
    key: "todos",
    label: "Todos",
    eyebrow: "Um sistema para beleza e bem-estar",
    theme: "bg-[#faf8f3] text-[#101514]",
    photos: [
      { src: "/images/salon-hero-barber-v2-hq.png", alt: "Corte masculino em barbearia", label: "Barbearia", position: "object-[64%_center]" },
      { src: "/images/salon-hero-stylist-v2-hq.png", alt: "Atendimento em salão de beleza", label: "Salão", position: "object-[54%_center]" },
      { src: "/images/salon-hero-manicure-v1-hq.png", alt: "Atendimento de manicure", label: "Manicure", position: "object-center" },
      { src: "/images/salon-hero-aesthetics-v2-hq.png", alt: "Tratamento de estética", label: "Estética", position: "object-center" },
      { src: "/images/salon-hero-massage-v2-hq.png", alt: "Massagem profissional", label: "Bem-estar", position: "object-center" },
    ],
    appointments: ["Corte masculino · Rafael", "Escova · Renata", "Massagem · Marina"],
  },
  {
    key: "barbearia",
    label: "Barbearias & cabeleireiros",
    eyebrow: "Agenda e gestão para barbearias e cabeleireiros",
    theme: "bg-[#0b100f] text-[#f4f5f2]",
    photos: [
      { src: "/images/salon-hero-barber-v2-hq.png", alt: "Barbeiro finalizando um corte masculino", label: "Corte & acabamento", position: "object-[64%_center]" },
      { src: "/images/salon-hero-male-haircut-v1-hq.png", alt: "Barbeiro realizando um corte masculino", label: "Corte masculino", position: "object-[60%_center]" },
      { src: "/images/salon-hero-beard-v1-hq.png", alt: "Barbeiro modelando a barba de um cliente", label: "Barba & cuidado", position: "object-[68%_center]" },
    ],
    appointments: ["Corte + barba · Rafael", "Degradê · Marcos", "Barba terapia · Rafael"],
  },
  {
    key: "salao",
    label: "Salão & manicure",
    eyebrow: "Agenda e gestão para salão e manicure",
    theme: "bg-[#fbf7f0] text-[#171513]",
    photos: [
      { src: "/images/salon-hero-stylist-v2-hq.png", alt: "Cabeleireira finalizando o cabelo de uma cliente", label: "Cabelo & beleza", position: "object-[56%_center]" },
      { src: "/images/salon-hero-manicure-v1-hq.png", alt: "Manicure atendendo uma cliente", label: "Manicure", position: "object-center" },
      { src: "/images/salon-hero-stylist-v1-hq.png", alt: "Atendimento em salão de beleza", label: "Coloração", position: "object-[55%_center]" },
    ],
    appointments: ["Corte feminino · Camila", "Escova · Renata", "Manicure · Júlia"],
  },
  {
    key: "bem-estar",
    label: "Estética & bem-estar",
    eyebrow: "Agenda e gestão para estética e bem-estar",
    theme: "bg-[#eef1e8] text-[#17201c]",
    photos: [
      { src: "/images/salon-hero-massage-v2-hq.png", alt: "Massagem profissional em ambiente de bem-estar", label: "Massagem", position: "object-[55%_center]" },
      { src: "/images/salon-hero-aesthetics-v2-hq.png", alt: "Tratamento facial profissional", label: "Estética facial", position: "object-center" },
      { src: "/images/salon-hero-massage-v1-hq.png", alt: "Atendimento de relaxamento", label: "Relaxamento", position: "object-center" },
    ],
    appointments: ["Limpeza de pele · Ana", "Massagem · Marina", "Drenagem · Ana"],
  },
];

const SEGMENT_DURATION_MS = 5_500;

export function AnimatedLandingHero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const resumeTimer = useRef<number | null>(null);
  const active = SEGMENTS[activeIndex];

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const interval = window.setInterval(
      () => setActiveIndex((current) => (current + 1) % SEGMENTS.length),
      SEGMENT_DURATION_MS,
    );
    return () => window.clearInterval(interval);
  }, [paused]);

  useEffect(() => () => {
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
  }, []);

  function selectSegment(index: number) {
    setActiveIndex(index);
    setPaused(true);
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => setPaused(false), 9_000);
  }

  return (
    <section
      className={cn("relative overflow-hidden pt-16 transition-colors duration-700 lg:h-[clamp(620px,100svh,900px)]", active.theme)}
      aria-label="Apresentação do Salon SaaS"
    >
      <div className="relative z-20 mx-auto grid max-w-[1920px] lg:h-[calc(clamp(620px,100svh,900px)-4rem)] lg:grid-cols-[43%_57%]">
        <div className="relative z-30 flex items-center px-6 py-12 sm:px-10 lg:px-12 lg:py-6 xl:pl-20 2xl:pl-40">
          <div className="max-w-[620px]">
            <div className={cn(
              "mb-5 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
              active.key === "barbearia" ? "border-[#7df89b]/25 bg-[#7df89b]/10 text-[#b8f2d8]" : "border-[#bcd5c9] bg-white/45 text-[#275947]",
            )}>
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{active.eyebrow}</span>
            </div>

            <h1 className="landing-title max-w-[680px] font-display text-5xl leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-[clamp(3rem,3.35vw,4rem)]">
              <span className="landing-title-line block">Seu espaço</span>
              <span className="landing-title-line block">organizado,</span>
              <span className="landing-title-line block">sua agenda sempre</span>
              <span className="landing-title-line block">em movimento.</span>
            </h1>

            <p className={cn("mt-5 max-w-xl text-base leading-relaxed sm:text-lg", active.key === "barbearia" ? "text-[#aab3af]" : "text-[#5c6461]")}>
              Agenda online, clientes, equipe e gestão em uma plataforma que se
              adapta aos seus serviços — do primeiro espaço à expansão da operação.
            </p>

            <div className="mt-7 flex flex-wrap gap-3 xl:flex-nowrap">
              <Button asChild size="lg" className="h-14 rounded-full px-6 text-base shadow-[0_16px_36px_-18px_rgba(23,139,101,.8)]">
                <Link href="/signup">Criar meu espaço <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild variant="outline" size="lg" className={cn("h-14 rounded-full px-6 text-base", active.key === "barbearia" && "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white")}>
                <Link href="/book/north-barber">Ver demonstração</Link>
              </Button>
            </div>
            <p className={cn("mt-3 text-sm", active.key === "barbearia" ? "text-[#818b87]" : "text-[#686f6c]")}>
              Envie sua solicitação e configure seu espaço após a aprovação.
            </p>
          </div>
        </div>

        <div
          className="relative min-h-[580px] lg:min-h-0"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="absolute inset-0 overflow-hidden 2xl:-right-[8vw]">
            <HeroCollage key={active.key} segment={active} />
          </div>

          <HeroDashboard appointments={active.appointments} />
        </div>
      </div>

      <div className="relative z-40 mx-auto -mt-9 flex max-w-[1920px] justify-center px-4 pb-7 lg:absolute lg:bottom-7 lg:left-0 lg:right-0 lg:mt-0 lg:justify-end lg:px-10 2xl:px-16">
        <div
          className="landing-scrollbar-hidden flex max-w-full gap-1 overflow-x-auto rounded-full border border-white/20 bg-[#101413]/85 p-1.5 shadow-xl backdrop-blur-xl"
          role="group"
          aria-label="Escolha o segmento mostrado"
        >
          {SEGMENTS.map((segment, index) => (
            <button
              key={segment.key}
              type="button"
              aria-pressed={index === activeIndex}
              onClick={() => selectSegment(index)}
              className={cn(
                "min-h-11 whitespace-nowrap rounded-full px-3.5 py-2.5 text-[11px] font-semibold text-white/75 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#101413] sm:px-4 sm:text-xs",
                index === activeIndex && (active.key === "bem-estar" ? "bg-[#738f7c] text-white" : "bg-[#49e8b4] text-[#0c241c]"),
              )}
            >
              {segment.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroCollage({ segment }: { segment: Segment }) {
  const general = segment.key === "todos";
  return (
    <div className="animate-photo-swap absolute inset-0 z-10">
      {general ? (
        <div className="grid h-full grid-cols-[1.15fr_.72fr_.72fr] grid-rows-2 gap-1 bg-[#d8d0c3]">
          <Photo photo={segment.photos[0]} className="row-span-2 lg:[clip-path:polygon(7%_0,100%_0,88%_100%,0_100%)]" labelClassName="left-3 lg:left-[12%]" priority sizes="(max-width: 1023px) 1100px, (max-width: 1919px) 80vw, 1500px" />
          <Photo photo={segment.photos[1]} sizes="(max-width: 1023px) 640px, (max-width: 1919px) 40vw, 760px" />
          <Photo photo={segment.photos[2]} sizes="(max-width: 1023px) 640px, (max-width: 1919px) 40vw, 760px" />
          <Photo photo={segment.photos[3]} sizes="(max-width: 1023px) 640px, (max-width: 1919px) 40vw, 760px" />
          <Photo photo={segment.photos[4]} sizes="(max-width: 1023px) 640px, (max-width: 1919px) 40vw, 760px" />
        </div>
      ) : (
        <div className="relative h-full bg-[#111513]">
          <Photo photo={segment.photos[0]} className="absolute inset-0" priority sizes="(max-width: 1023px) 1100px, (max-width: 1919px) 80vw, 1500px" />
          <Photo photo={segment.photos[1]} className="absolute bottom-0 left-0 z-10 h-[40%] w-[47%] border-r-2 border-white/70 [clip-path:polygon(0_18%,88%_0,100%_100%,10%_100%)]" labelClassName="bottom-4 left-[15%] top-auto" sizes="(max-width: 1023px) 480px, (max-width: 1919px) 34vw, 640px" />
          <Photo photo={segment.photos[2]} className="absolute bottom-0 right-0 z-10 h-[42%] w-[34%] border-l-2 border-white/70 [clip-path:polygon(14%_0,100%_8%,100%_100%,0_100%)]" labelClassName="left-[20%]" sizes="(max-width: 1023px) 480px, (max-width: 1919px) 34vw, 640px" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/20" />
    </div>
  );
}

function Photo({
  photo,
  className,
  labelClassName,
  priority = false,
  sizes,
}: {
  photo: Segment["photos"][number];
  className?: string;
  labelClassName?: string;
  priority?: boolean;
  sizes: string;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-[#d9d4ca]", className)}>
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        priority={priority}
        loading={priority ? undefined : "eager"}
        quality={95}
        sizes={sizes}
        className={cn("object-cover", photo.position)}
      />
      {photo.label && <span className={cn("absolute left-4 top-4 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm backdrop-blur", labelClassName)}>{photo.label}</span>}
    </div>
  );
}

function HeroDashboard({ appointments }: { appointments: string[] }) {
  return (
    <div className="absolute bottom-20 left-[8%] right-[3%] z-20 hidden overflow-hidden rounded-[1.6rem] border border-white/15 bg-[#202322]/95 text-white shadow-[0_35px_80px_-28px_rgba(4,8,7,.85)] backdrop-blur-md sm:block lg:left-[5%] lg:right-[10%]">
      <div className="flex h-12 items-center gap-2 border-b border-white/10 px-4">
        <i className="h-2.5 w-2.5 rounded-full bg-[#e65d52]" /><i className="h-2.5 w-2.5 rounded-full bg-[#eba644]" /><i className="h-2.5 w-2.5 rounded-full bg-[#44c68f]" />
        <span className="ml-3 rounded-full bg-black/20 px-3 py-1 text-[10px] text-white/60">app.salonsaas.com/dashboard</span>
      </div>
      <div className="grid min-h-[238px] grid-cols-[130px_1fr]">
        <div className="space-y-1 border-r border-white/10 p-3 text-[11px] text-white/55">
          {[{ icon: LayoutDashboard, label: "Dashboard" }, { icon: CalendarDays, label: "Agenda" }, { icon: Users, label: "Clientes" }, { icon: Wallet, label: "Financeiro" }].map((item, index) => (
            <div key={item.label} className={cn("flex items-center gap-2 rounded-xl px-3 py-2.5", index === 0 && "bg-[#35ba89]/15 text-[#58e6b1]")}><item.icon className="h-3.5 w-3.5" />{item.label}</div>
          ))}
        </div>
        <div className="p-4">
          <p className="text-sm font-semibold">Hoje</p>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {["Agendamentos", "Faturamento", "Ocupação"].map((label, index) => <div key={label} className="rounded-xl border border-white/10 p-3 text-[9px] text-white/60">{label}<span className="mt-2 block h-1.5 rounded-full bg-[#308c68]" style={{ width: `${78 - index * 7}%` }} /></div>)}
          </div>
          <div className="mt-3 rounded-xl border border-white/10 px-3">
            {appointments.map((label, index) => <div key={label} className="grid grid-cols-[48px_1fr] border-b border-white/10 py-2 text-[10px] last:border-0"><strong className="text-[#4ce1a9]">{["09:00", "10:30", "13:00"][index]}</strong><span className="text-white/65">{label}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingReveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={cn("landing-reveal", visible && "is-visible", className)}>{children}</div>;
}
