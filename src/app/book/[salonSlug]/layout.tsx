import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trimly — mais que um corte",
};

/**
 * Route layout do lado cliente. Aplica o tema `salon-dark` via data-attribute
 * na div raiz — as CSS variables em globals.css `[data-theme="salon-dark"]`
 * ganham daquele ponto pra baixo.
 *
 * Também restringe a largura ao formato "mobile" (max 480px) centralizando,
 * pra que a experiência pareça um app tanto em celular quanto em desktop.
 */
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-theme="salon-dark"
      className="min-h-screen bg-background text-foreground"
    >
      <div className="mx-auto min-h-screen w-full max-w-[480px] pb-24">
        {children}
      </div>
    </div>
  );
}
