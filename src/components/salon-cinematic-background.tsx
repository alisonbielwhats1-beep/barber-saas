"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CINEMATIC_SCENES = [
  "/images/salon-hero-stylist-v1.webp",
  "/images/salon-hero-male-haircut-v1.webp",
  "/images/salon-hero-beard-v1.webp",
  "/images/salon-hero-massage-v1.webp",
  "/images/salon-hero-aesthetics-v1.webp",
] as const;

const SCENE_DURATION_MS = 7_500;

export function SalonCinematicBackground({
  variant = "hero",
  priority = false,
}: {
  variant?: "hero" | "auth";
  priority?: boolean;
}) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [previousSceneIndex, setPreviousSceneIndex] = useState<number | null>(null);
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const interval = window.setInterval(() => {
      setSceneIndex((currentIndex) => {
        setPreviousSceneIndex(currentIndex);
        setSceneReady(false);
        return (currentIndex + 1) % CINEMATIC_SCENES.length;
      });
    }, SCENE_DURATION_MS);

    return () => window.clearInterval(interval);
  }, []);

  const imagePosition =
    variant === "hero"
      ? "object-[68%_center] md:object-center"
      : "object-[66%_center] lg:object-center";
  const imageOpacity =
    variant === "hero"
      ? "opacity-65 md:opacity-75"
      : "opacity-45 sm:opacity-55 lg:opacity-70";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {previousSceneIndex !== null && previousSceneIndex !== sceneIndex ? (
        <div className={cn("absolute inset-0", imageOpacity)}>
          <div
            className={cn(
              "absolute inset-0 transition-opacity duration-1000 ease-out",
              sceneReady ? "opacity-0" : "opacity-100",
            )}
          >
            <Image
              src={CINEMATIC_SCENES[previousSceneIndex]}
              alt=""
              fill
              sizes="100vw"
              className={cn("animate-cinematic-drift object-cover", imagePosition)}
            />
          </div>
        </div>
      ) : null}

      <div className={cn("absolute inset-0", imageOpacity)}>
        <div
          key={CINEMATIC_SCENES[sceneIndex]}
          className={cn(
            "absolute inset-0 transition-opacity duration-1000 ease-out",
            sceneReady || sceneIndex === 0 ? "opacity-100" : "opacity-0",
          )}
        >
          <Image
            src={CINEMATIC_SCENES[sceneIndex]}
            alt=""
            fill
            priority={priority && sceneIndex === 0}
            sizes="100vw"
            onLoad={() => setSceneReady(true)}
            className={cn("animate-cinematic-drift object-cover", imagePosition)}
          />
        </div>
      </div>

      <div
        className={cn(
          "absolute inset-0",
          variant === "hero"
            ? "bg-[linear-gradient(90deg,hsl(var(--background))_0%,hsl(var(--background)/0.96)_28%,hsl(var(--background)/0.58)_62%,hsl(var(--background)/0.28)_100%)]"
            : "bg-[linear-gradient(90deg,hsl(var(--background)/0.98)_0%,hsl(var(--background)/0.86)_38%,hsl(var(--background)/0.34)_100%)]",
        )}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_42%,hsl(var(--primary)/0.12),transparent_34%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
