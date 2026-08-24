import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Ação somente com ícone precisa continuar compreensível fora do mouse.
 * O alvo mínimo de 44px é intencional: mantém a mesma política de toque do
 * restante do painel e deixa o nome disponível para leitor de tela.
 */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(({ className, label, title, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    aria-label={label}
    title={title ?? label}
    className={cn(
      "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));

IconButton.displayName = "IconButton";
