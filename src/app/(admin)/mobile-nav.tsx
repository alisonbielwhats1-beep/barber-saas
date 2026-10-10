"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LayoutGrid, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/unread-badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { matchesPath } from "./sidebar-nav";
import { openSecretary } from "./secretary-open";
import { OPEN_MORE_EVENT, mobileTabsFor, moreGroupsFor } from "./mobile-navigation";
import {
  COMMAND_PALETTE_NAVIGATE_EVENT,
  OPEN_COMMAND_PALETTE_EVENT,
  OpenCommandPaletteButton,
  requestCommandPaletteOpen,
} from "./command-palette";

type MobileNavProps = {
  role: string;
  unreadNotifications?: number;
  isPlatformAdmin?: boolean;
  /** Estabelecimento, plano e tema: o cartão do topo do "Mais". */
  accountControls?: React.ReactNode;
  /** Perfil e "Sair": ficam no fim do "Mais". */
  accountFooter?: React.ReactNode;
  /** Aba "Secretária" no meio da barra (os avisos passam para o sino do topo). */
  secretary?: boolean;
};

/**
 * Navegação de aplicativo do painel abaixo de 1024px: barra de abas fixa
 * (Hoje, Agenda, Clientes, Avisos) e "Mais", que sobe um painel com os demais
 * módulos em listas agrupadas. O computador continua com a barra lateral.
 */
export function MobileNav({
  role,
  unreadNotifications = 0,
  isPlatformAdmin = false,
  accountControls,
  accountFooter,
  secretary = false,
}: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const openRef = useRef(open);
  const paletteRequestPendingRef = useRef(false);
  const tabs = mobileTabsFor(role, secretary);

  useEffect(() => {
    openRef.current = open;
    if (open || !paletteRequestPendingRef.current) return;
    // O "Mais" já fechou e devolveu o foco ao gatilho: agora a busca pode abrir
    // como único modal, voltando para esse gatilho estável ao fechar.
    paletteRequestPendingRef.current = false;
    const returnTarget = trigger.current;
    queueMicrotask(() => requestCommandPaletteOpen(returnTarget));
  }, [open]);

  useEffect(() => {
    const closeBeforePalette = (event: Event) => {
      if (!openRef.current) return;
      event.preventDefault();
      paletteRequestPendingRef.current = true;
      setOpen(false);
    };
    const closeAfterNavigation = () => setOpen(false);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, closeBeforePalette);
    window.addEventListener(COMMAND_PALETTE_NAVIGATE_EVENT, closeAfterNavigation);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, closeBeforePalette);
      window.removeEventListener(COMMAND_PALETTE_NAVIGATE_EVENT, closeAfterNavigation);
    };
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  // "Voltar" da barra superior de uma tela filha pede o "Mais" de volta.
  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_MORE_EVENT, reopen);
    return () => window.removeEventListener(OPEN_MORE_EVENT, reopen);
  }, []);

  const moreActive = open || !tabs.some((tab) => matchesPath(pathname, tab.href));

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          mobileSheet
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}
          className="mais-sheet gap-5 bg-background sm:max-w-md"
        >
          <DialogTitle className="sr-only">Todos os módulos</DialogTitle>
          {/* Título visível de tela de app; o nome acessível continua "Todos os módulos". */}
          <p aria-hidden="true" className="flex min-h-7 items-center pr-12 text-2xl font-semibold tracking-tight">Mais</p>
          {accountControls}
          <OpenCommandPaletteButton />
          <MoreGroups role={role} isPlatformAdmin={isPlatformAdmin} secretary={secretary} pathname={pathname} onNavigate={() => setOpen(false)} />
          {accountFooter && <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-inset ring-border [&>div]:border-t-0">{accountFooter}</div>}
        </DialogContent>
      </Dialog>

      {/* Barra de abas */}
      <nav
        aria-label="Navegação do aplicativo"
        style={{ paddingLeft: "var(--safe-left)", paddingRight: "var(--safe-right)" }}
        className="app-tabbar admin-mobile-bar fixed inset-x-0 bottom-0 z-50 flex border-t border-border bg-card/90 pb-[var(--safe-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden print:hidden"
      >
        {tabs.map((tab) => {
          const active = !open && matchesPath(pathname, tab.href);
          const count = tab.badge === "notifications" ? unreadNotifications : 0;
          return (
            <Fragment key={tab.href}>
            {secretary && tab.href === "/clientes" && <SecretaryTab />}
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              aria-label={count > 0 ? `${tab.label}, ${count} não lidas` : undefined}
              onClick={() => setOpen(false)}
              className={cn(
                "app-tabbar-item admin-mobile-bar-item flex min-h-16 flex-1 flex-col items-center justify-center gap-[3px] px-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active ? "text-[hsl(var(--selection-foreground))]" : "text-muted-foreground",
              )}
            >
              <span className="app-tabbar-icon relative grid h-[30px] w-[54px] place-items-center rounded-full">
                <tab.icon aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={active ? 2.1 : 1.8} />
                {count > 0 && <UnreadBadge count={count} className="absolute -top-1 right-1" />}
              </span>
              {tab.label}
            </Link>
            </Fragment>
          );
        })}
        <button
          ref={trigger}
          type="button"
          aria-label="Abrir todos os módulos"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-active={moreActive}
          onClick={() => setOpen(true)}
          className={cn(
            "app-tabbar-item admin-mobile-bar-item flex min-h-16 flex-1 flex-col items-center justify-center gap-[3px] px-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            moreActive ? "text-[hsl(var(--selection-foreground))]" : "text-muted-foreground",
          )}
        >
          <span className="app-tabbar-icon relative grid h-[30px] w-[54px] place-items-center rounded-full">
            <LayoutGrid aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={moreActive ? 2.1 : 1.8} />
            {secretary && unreadNotifications > 0 && <UnreadBadge count={unreadNotifications} className="absolute -top-1 right-1" />}
          </span>
          Mais
        </button>
      </nav>
    </>
  );
}

/** Aba da Secretária no meio da barra, com a marca lilás; abre o painel dela (que escuta o evento). */
function SecretaryTab() {
  return (
    <button
      type="button"
      aria-label="Abrir Secretária"
      aria-haspopup="dialog"
      onClick={openSecretary}
      className="secretary-nav-item app-tabbar-item admin-mobile-bar-item flex min-h-16 flex-1 flex-col items-center justify-center gap-[3px] px-1 text-xs font-semibold text-[hsl(var(--selection-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="app-tabbar-brand relative grid h-[34px] w-12 place-items-center rounded-[13px] bg-[hsl(var(--selection-solid))] text-[hsl(var(--selection-on-solid))] shadow-[0_6px_18px_rgb(0_0_0/0.35)]">
        <Sparkles aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
      </span>
      Secretária
    </button>
  );
}

function MoreGroups({ role, isPlatformAdmin, secretary, pathname, onNavigate }: { role: string; isPlatformAdmin: boolean; secretary: boolean; pathname: string; onNavigate: () => void }) {
  const groups = moreGroupsFor(role, isPlatformAdmin, secretary);
  return (
    <nav id="admin-mobile-navigation" aria-label="Navegação principal" className="space-y-5">
      {groups.map((group) => (
        <section key={group.title} aria-labelledby={`mais-${group.title}`}>
          <h2 id={`mais-${group.title}`} className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{group.title}</h2>
          <ul className="overflow-hidden rounded-2xl bg-card ring-1 ring-inset ring-border">
            {group.links.map((link) => {
              const path = link.href.split("#")[0].split("?")[0];
              // Atalhos com filtro (?segment=…) ou âncora (#…) não marcam a página inteira como atual.
              const active = !/[?#]/.test(link.href) && matchesPath(pathname, path);
              return (
                <li key={link.href} className="border-b border-border last:border-b-0">
                  <Link
                    href={link.href}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    className="press-row flex min-h-[3.25rem] items-center gap-3 px-3.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className={cn("grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px]", active ? "bg-[hsl(var(--selection))] text-[hsl(var(--selection-foreground))]" : "bg-muted text-foreground")}>
                      <link.icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.8} />
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate text-base", active ? "font-semibold" : "font-medium")}>{link.label}</span>
                    <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
