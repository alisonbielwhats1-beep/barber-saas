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
    image: "/images/salon-hero-stylist-v1.webp",
    icon: Sparkles,
    position: "object-center",
  },
  {
    label: "Barbearia",
    eyebrow: "Corte e barba",
    image: "/images/salon-hero-male-haircut-v1.webp",
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
    image: "/images/salon-hero-massage-v1.webp",
    icon: Waves,
    position: "object-center",
  },
  {
    label: "Estética",
    eyebrow: "Pele e tratamentos",
    image: "/images/salon-hero-aesthetics-v1.webp",
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
    <section className="relative overflow-hidden pb-20 pt-28 md:pb-28 md:pt-36">
      <div className="landing-orbit landing-orbit-one" aria-hidden="true" />
      <div className="landing-orbit landing-orbit-two" aria-hidden="true" />

      <div className="container relative z-10 grid gap-14 lg:min-h-[650px] lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:gap-10">
        <div className="animate-fade-in">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            A rotina do seu espaço, em um só lugar
          </div>

          <h1 className="max-w-2xl font-display text-5xl leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-[4.75rem]">
            Seu espaço organizado,
            <span className="mt-2 block text-primary">sua agenda em movimento.</span>
          </h1>

          <p className="mt-7 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Agenda, clientes, equipe e gestão em um só lugar — para barbearias,
            salões, unhas, estética, massagem e espaços mistos.
          </p>

          <div className="mt-8 flex max-w-xl flex-wrap gap-2" aria-label="Escolha um segmento para visualizar">
            {HERO_SCENES.map((scene, index) => {
              const Icon = scene.icon;
              const selected = index === activeIndex;

              return (
                <button
                  key={scene.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    "group inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    selected
                      ? "border-primary bg-primary text-primary-foreground shadow-[0_10px_28px_-14px_hsl(var(--primary)/0.8)]"
                      : "border-border bg-white/60 text-muted-foreground hover:border-primary/30 hover:bg-white hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {scene.label}
                </button>
              );
            })}
          </div>

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
          className="relative min-h-[520px] sm:min-h-[610px] lg:min-h-[650px]"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="absolute inset-x-0 top-0 grid h-[470px] grid-cols-[1.25fr_0.75fr] grid-rows-2 gap-3 sm:h-[540px] sm:gap-4">
            <HeroPhoto scene={active} className="row-span-2" priority />
            <HeroPhoto scene={next} priority />
            <HeroPhoto scene={afterNext} priority />
          </div>

          <div className="absolute left-3 top-3 z-20 rounded-full border border-white/25 bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md sm:left-5 sm:top-5">
            <span aria-live="polite">{active.eyebrow}</span>
          </div>

          <div className="absolute bottom-3 left-4 right-1 z-30 sm:bottom-0 sm:left-10 lg:-right-8 lg:left-6">
            <div className="animate-landing-float rounded-[1.7rem] bg-[#111513]/94 p-1.5 shadow-[0_28px_70px_-28px_rgba(12,22,17,0.75)] backdrop-blur-md" data-theme="marketing-dark">
              <ProductMockup />
            </div>
          </div>

          <div className="absolute bottom-0 right-2 z-40 flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur sm:right-4">
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
        </div>
      </div>
    </section>
  );
}

function HeroPhoto({
  scene,
  className,
  priority = false,
}: {
  scene: HeroScene;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div
      key={scene.image}
      className={cn(
        "animate-photo-swap group relative overflow-hidden rounded-[1.75rem] bg-muted shadow-[0_24px_60px_-34px_rgba(30,45,38,0.55)]",
        className,
      )}
    >
      <Image
        src={scene.image}
        alt={`${scene.label}: ${scene.eyebrow}`}
        fill
        priority={priority}
        sizes="(max-width: 1024px) 65vw, 42vw"
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
