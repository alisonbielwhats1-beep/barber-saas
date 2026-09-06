import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "./brand";
import { SalonCinematicBackground } from "./salon-cinematic-background";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="relative min-h-dvh overflow-x-hidden bg-background outline-none">
      <SalonCinematicBackground variant="auth" priority />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-7xl items-start px-4 py-8 sm:items-center sm:px-8 sm:py-12 lg:px-12">
        <div className="w-full max-w-[410px]">
          <Link href="/" className="mb-6 flex items-center gap-2.5 sm:mb-8">
            <BrandLogo />
          </Link>

          <div className="rounded-3xl border border-white/10 bg-card/90 p-5 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-7">
            <div className="mb-6">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/70">
                {description}
              </p>
            </div>

            {children}

            <div className="mt-5 text-center text-[12px] text-foreground/70">
              {footer}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
