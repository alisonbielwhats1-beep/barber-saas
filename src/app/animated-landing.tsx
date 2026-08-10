"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Gem,
  Scissors,
  ShieldCheck,
  Sparkles,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProductMockup } from "./product-mockup";

type HeroScene = {
  label: string;
  eyebrow: string;
  image: string;
  icon: LucideIcon;
  position?: string;
};

const HERO_SCENES: HeroScene[] = [
  {
    label: "Salão",
    eyebrow: "Cabelo e beleza",
    image: "/images/salon-hero-stylist-v2.webp",
    icon: Sparkles,
    position: "object-center",
  },
  {
    label: "Barbearia",
    eyebrow: "Corte e barba",
    image: "/images/salon-hero-barber-v2.webp",
    icon: Scissors,
    position: "object-center",
  },
  {
    label: "Manicure",
    eyebrow: "Unhas e cuidado",
    image: "/images/salon-hero-manicure-v1.webp",
    icon: Gem,
    position: "object-center",
  },
  {
    label: "Massagem",
    eyebrow: "Corpo e bem-estar",
    image: "/images/salon-hero-massage-v2.webp",
    icon: Waves,
    position: "object-center",
  },
  {
    label: "Estética",
    eyebrow: "Pele e tratamentos",
    image: "/images/salon-hero-aesthetics-v2.webp",
    icon: ShieldCheck,
    position: "object-center",
  },
];

const SCENE_DURATION_MS = 6_500;

export function AnimatedLandingHero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % HERO_SCENES.length);
    }, SCENE_DURATION_MS);

    return () => window.clearInterval(interval);
  }, [paused]);

  const active = HERO_SCENES[activeIndex];
  const next = HERO_SCENES[(activeIndex + 1) % HERO_SCENES.length];
  const afterNext = HERO_SCENES[(activeIndex + 2) % HERO_SCENES.length];

  return (
    <section className="relative overflow-hidden pb-16 pt-28 md:pb-24 md:pt-32 lg:pt-16">
      <div className="landing-orbit landing-orbit-one" aria-hidden="true" />
      <div className="landing-orbit landing-orbit-two" aria-hidden="true" />

      <div className="container relative z-10 grid gap-14 lg:min-h-[700px] lg:grid-cols-[0.78fr_1.22fr] lg:items-center lg:gap-5">
        <div className="relative z-20 lg:py-16">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            A rotina do seu espaço, em um só lugar
          </div>

          <h1 className="landing-title max-w-2xl font-display text-5xl leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-[4.15rem] xl:text-[4.55rem]">
            <span className="landing-title-line block">Seu espaço</span>
            <span className="landing-title-line block">organizado,</span>
            <span className="landing-title-line mt-2 block text-primary">sua agenda sempre em</span>
            <span className="landing-title-line block text-primary">movimento.</span>
          </h1>

          <p className="mt-7 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Agenda, clientes, equipe e gestão em um só lugar — para barbearias,
            salões, unhas, estética, massagem e espaços mistos.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-14 rounded-full px-8 text-base shadow-[0_16px_36px_-18px_hsl(var(--primary)/0.8)]">
              <Link href="/signup">
                Criar meu espaço <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-14 rounded-full border-border bg-white/55 px-8 text-base hover:bg-white"
            >
              <Link href="/book/north-barber">Conhecer a plataforma</Link>
            </Button>
          </div>

          <p className="mt-5 text-sm text-muted-foreground">
            Envie sua solicitação e configure seu espaço após a aprovação.
          </p>
        </div>

        <div
          className="relative min-h-[545px] sm:min-h-[630px] lg:-mr-8 lg:min-h-[700px] xl:-mr-16 2xl:-mr-[calc((100vw-1360px)/2)]"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="landing-collage absolute inset-x-0 top-0 grid h-[490px] grid-cols-[1.3fr_0.7fr] grid-rows-2 gap-2 sm:h-[565px] lg:h-[700px] lg:gap-1">
            <HeroPhoto scene={active} className="landing-collage-main row-span-2" priority sizes="(max-width: 1024px) 65vw, 50vw" />
            <HeroPhoto scene={next} className="landing-collage-side landing-collage-side-top" priority sizes="(max-width: 1024px) 35vw, 28vw" />
            <HeroPhoto scene={afterNext} className="landing-collage-side landing-collage-side-bottom" priority sizes="(max-width: 1024px) 35vw, 28vw" />
          </div>

          <div className="absolute left-3 top-3 z-20 rounded-full border border-white/25 bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md sm:left-5 sm:top-5 lg:left-[12%]">
            <span aria-live="polite">{active.eyebrow}</span>
          </div>

          <div className="absolute bottom-3 left-4 right-1 z-30 sm:bottom-0 sm:left-10 lg:bottom-9 lg:left-[10%] lg:right-[5%]">
            <div className="animate-landing-float rounded-[1.7rem] bg-[#111513]/96 p-1.5 shadow-[0_32px_80px_-25px_rgba(5,12,9,0.85)] backdrop-blur-md" data-theme="marketing-dark">
              <ProductMockup />
            </div>
          </div>

          <div className="absolute bottom-0 right-2 z-40 flex items-center gap-2 rounded-full border border-white/15 bg-[#111513]/90 px-3 py-2 text-white shadow-lg backdrop-blur sm:right-4 lg:bottom-3 lg:right-[5%]" data-theme="marketing-dark">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {String(activeIndex + 1).padStart(2, "0")} / {String(HERO_SCENES.length).padStart(2, "0")}
            </span>
            <span className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                key={`${activeIndex}-${paused}`}
                className={cn("block h-full rounded-full bg-primary", !paused && "animate-landing-progress")}
              />
            </span>
          </div>

          <div className="absolute right-2 top-20 z-40 flex flex-col gap-1 rounded-full border border-white/15 bg-black/45 p-1.5 backdrop-blur-md sm:right-4 sm:top-24 lg:right-[3%]" aria-label="Escolha um segmento para visualizar">
            {HERO_SCENES.map((scene, index) => {
              const Icon = scene.icon;
              const selected = index === activeIndex;

              return (
                <button
                  key={scene.label}
                  type="button"
                  aria-label={`Mostrar ${scene.label}`}
                  aria-pressed={selected}
                  title={scene.label}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full text-white/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                    selected ? "bg-primary text-primary-foreground" : "hover:bg-white/15 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroPhoto({
  scene,
  className,
  priority = false,
  sizes,
}: {
  scene: HeroScene;
  className?: string;
  priority?: boolean;
  sizes: string;
}) {
  return (
    <div
      key={scene.image}
      className={cn(
        "animate-photo-swap group relative overflow-hidden rounded-[1.5rem] bg-muted shadow-[0_24px_60px_-34px_rgba(30,45,38,0.55)] lg:rounded-none",
        className,
      )}
    >
      <Image
        src={scene.image}
        alt={`${scene.label}: ${scene.eyebrow}`}
        fill
        priority={priority}
        sizes={sizes}
        quality={90}
        className={cn("object-cover transition duration-1000 group-hover:scale-[1.025]", scene.position)}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/5" />
      <span className="absolute bottom-3 left-3 rounded-full border border-white/20 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md sm:bottom-4 sm:left-4">
        {scene.label}
      </span>
    </div>
  );
}

export function LandingReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("landing-reveal", visible && "is-visible", className)}>
      {children}
    </div>
  );
}
