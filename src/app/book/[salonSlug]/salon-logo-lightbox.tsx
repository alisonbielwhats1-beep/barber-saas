"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { X, ZoomIn } from "lucide-react";

export function SalonLogoLightbox({
  src,
  alt,
  salonName,
  className,
  children,
}: {
  src: string | null;
  alt: string;
  salonName: string;
  className: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const thumbnail = src ? (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes="160px"
      quality={95}
      className="object-contain transition-transform duration-200 group-hover:scale-[1.03]"
    />
  ) : (
    children
  );

  return (
    <>
      {src ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Ampliar logo de ${salonName}`}
          className={`group relative cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${className}`}
        >
          {thumbnail}
          <span
            aria-hidden="true"
            className="absolute bottom-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white shadow-sm"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        <div className={`relative ${className}`}>{thumbnail}</div>
      )}

      {src && open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Logo ampliado de ${salonName}`}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar logo ampliado"
            className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="relative h-[min(78dvh,720px)] w-[min(92vw,1100px)] overflow-hidden rounded-2xl border border-white/20 bg-white p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <Image
              src={src}
              alt={alt}
              fill
              priority
              unoptimized
              quality={95}
              sizes="(max-width: 640px) 92vw, 1100px"
              className="object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
