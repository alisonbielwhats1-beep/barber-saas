"use client";

import { useEffect, useState } from "react";
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

  return (
    <>
    <header
      id="top"
      className="fixed inset-x-0 top-0 z-50 border-b border-border/70 bg-background/80 shadow-[0_8px_30px_-28px_rgba(20,35,28,0.55)] backdrop-blur-xl"
    >
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-display text-xl">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          Salon<span className="text-primary">SaaS</span>
        </Link>

        {/* Nav desktop */}
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition hover:text-foreground">
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
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-white/50 text-foreground md:hidden"
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
      <nav className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-border bg-background px-6 pb-6 pt-2 md:hidden">
        <div className="flex flex-col gap-1">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-sm text-muted-foreground transition hover:bg-card hover:text-foreground"
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
