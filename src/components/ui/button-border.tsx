import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Brilho que percorre a borda do elemento pai para chamar atenção a uma ação
 * pendente (aviso, notificação não lida, instalação disponível). Use com
 * parcimônia e só enquanto a condição existir: movimento permanente vira ruído.
 *
 * O pai precisa ser `relative` e ter `border-radius`; o raio do trajeto deve
 * acompanhar o do pai (ex.: 9999 para `rounded-full`).
 * Implementado em CSS puro (`offset-path`), sem JS no cliente; some com
 * `prefers-reduced-motion` e em navegadores sem suporte a `offset-path: rect()`.
 */
export function AnimatedBorder({ radius = 20, className }: { radius?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("animated-border", className)}
      style={{ "--animated-border-radius": `${radius}px` } as React.CSSProperties}
    >
      <span className="animated-border-dot" />
    </span>
  );
}
