"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductWordmark } from "@/components/product-wordmark";

const NAV_LINKS = [
  { href: "#top", label: "Início" },
  { href: "#recursos", label: "Recursos" },
  { href: "#segmentos", label: "Para quem é" },
  { href: "#planos", label: "Planos" },
];

/** Cabeçalho comercial com a mesma marca tipográfica usada no produto. */
export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Trava o scroll do fundo enquanto o menu mobile está aberto — sem isso
  // dava pra rolar a página por trás do painel, que não cobre tudo.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <>
    <header
      id="top"
      data-scrolled={scrolled || undefined}
      className="marketing-header fixed inset-x-0 top-0 z-50 border-b border-transparent transition duration-300"
    >
      <div className="container flex h-[4.5rem] items-center justify-between">
        <ProductWordmark />

        {/* Nav desktop */}
        <nav className="hidden items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.025] p-1 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-4 py-2 transition hover:bg-white/[0.06] hover:text-foreground">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Criar conta grátis</Link>
          </Button>
        </div>

        {/* Toggle mobile */}
        <button
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-foreground md:hidden"
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
      <nav className="fixed inset-x-0 bottom-0 top-[4.5rem] z-40 overflow-y-auto border-t border-white/5 bg-background/98 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-2xl md:hidden">
        <div className="flex flex-col gap-1">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex min-h-14 items-center rounded-2xl border border-transparent px-4 text-base text-muted-foreground transition hover:border-border hover:bg-card hover:text-foreground"
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
            <Link href="/signup">Criar conta grátis</Link>
          </Button>
        </div>
      </nav>
    )}
    </>
  );
}
