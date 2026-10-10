"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Seção recolhível de Resultados (Relatórios e Financeiro). Continua sendo um <details> nativo, para a
 * impressão abrir tudo antes de imprimir (report-actions.tsx). No computador as
 * seções marcadas com `openOnDesktop` já aparecem abertas, como no protótipo;
 * no celular ficam recolhidas até a pessoa tocar.
 */
export function FoldSection({
  id,
  title,
  sub,
  defaultOpen = false,
  openOnDesktop = false,
  leading,
  children,
}: {
  id: string;
  title: string;
  sub?: string;
  defaultOpen?: boolean;
  openOnDesktop?: boolean;
  /** Pastilha de ícone antes do título (opcional). */
  leading?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (openOnDesktop && ref.current && window.matchMedia("(min-width: 1024px)").matches) ref.current.open = true;
  }, [openOnDesktop]);
  return (
    <details ref={ref} open={defaultOpen || undefined} className="group min-w-0 overflow-hidden rounded-[14px] border border-border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        {leading}
        <span className="min-w-0 flex-1">
          <span id={id} className="block text-sm font-semibold leading-snug">{title}</span>
          {sub ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{sub}</span> : null}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div>{children}</div>
    </details>
  );
}
