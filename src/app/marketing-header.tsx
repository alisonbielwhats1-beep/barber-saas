"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "#top", label: "Início" },
  { href: "#recursos", label: "Recursos" },
  { href: "#segmentos", label: "Para quem é" },
  { href: "#planos", label: "Planos" },
];

/**
 * Cabeçalho da homepage comercial. Marca é wordmark + símbolo abstrato
 * (Sparkles) — decisão temporária até etapa própria de branding definir
 * um logotipo oficial. Não usa o ícone Scissors do painel administrativo.
 */
export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstMobileLinkRef = useRef<HTMLAnchorElement>(null);

  // Trava o scroll do fundo enquanto o menu mobile está aberto — sem isso
  // dava pra rolar a página por trás do painel, que não cobre tudo.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstMobileLinkRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuButtonRef.current?.focus();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
    <a
      href="#main-content"
      className="fixed left-4 top-3 z-[70] inline-flex min-h-11 -translate-y-20 items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-white"
    >
      Pular para o conteúdo
    </a>
    <header
      id="top"
      data-theme="marketing-dark"
      className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#131715]/95 text-foreground shadow-[0_8px_30px_-24px_rgba(5,12,9,0.8)] backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between px-6 sm:px-10">
        <Link href="/" className="flex min-h-11 items-center gap-2 rounded-lg font-display text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#131715]">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          Salon<span className="text-primary">SaaS</span>
        </Link>

        {/* Nav desktop */}
        <nav aria-label="Navegação principal" className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-sm transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#131715]">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Criar meu espaço</Link>
          </Button>
        </div>

        {/* Toggle mobile */}
        <button
          ref={menuButtonRef}
          type="button"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          aria-controls="menu-mobile-marketing"
          onClick={() => setOpen((v) => !v)}
          className="grid h-11 w-11 place-items-center rounded-lg border border-white/15 bg-white/5 text-foreground transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#131715] md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
    </header>

    {/* Menu mobile — painel de tela cheia, fora do <header> de propósito:
        o backdrop-blur do header cria containing block para descendentes
        fixed, o que travava esse painel numa altura errada (~33px). Como
        irmão do header, ele usa a viewport de verdade e cobre 100% do
        conteúdo por trás. */}
    {open && (
      <nav id="menu-mobile-marketing" aria-label="Navegação mobile" data-theme="marketing-dark" className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-white/10 bg-[#131715] px-6 pb-6 pt-2 md:hidden">
        <div className="flex flex-col gap-1">
          {NAV_LINKS.map((l) => (
            <a
              ref={l.href === "#top" ? firstMobileLinkRef : undefined}
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-lg px-3 py-3 text-sm text-muted-foreground transition hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Button asChild variant="outline" onClick={() => setOpen(false)}>
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild onClick={() => setOpen(false)}>
            <Link href="/signup">Criar meu espaço</Link>
          </Button>
        </div>
      </nav>
    )}
    </>
  );
}
