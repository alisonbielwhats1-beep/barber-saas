"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, Scissors, ShoppingBag, Layers, Image as ImageIcon,
  Users, UserCog, Wallet, FileBarChart, Megaphone, Settings, Search, CornerDownLeft, Command,
} from "lucide-react";
import {
  DASHBOARD_ROLES,
  FINANCIAL_ROLES,
  MANAGEMENT_ROLES,
  MARKETING_ROLES,
} from "@/lib/role-permissions";
import { commandShortcutLabel } from "@/lib/platform-shortcut";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type Cmd = { label: string; hint: string; icon: typeof Search; href: string; roles?: readonly string[] };

export const OPEN_COMMAND_PALETTE_EVENT = "open-command-palette";
export const COMMAND_PALETTE_NAVIGATE_EVENT = "command-palette-navigate";

type CommandPaletteOpenDetail = {
  returnFocusTo?: HTMLElement | null;
};

/**
 * Single entry point for opening the palette. The request is cancelable so an
 * open modal can close first and replay it with a stable focus target.
 */
export function requestCommandPaletteOpen(returnFocusTo?: HTMLElement | null) {
  window.dispatchEvent(new CustomEvent<CommandPaletteOpenDetail>(
    OPEN_COMMAND_PALETTE_EVENT,
    {
      cancelable: true,
      detail: { returnFocusTo },
    },
  ));
}

const COMMANDS: Cmd[] = [
  { label: "Dashboard", hint: "Visão geral", icon: LayoutDashboard, href: "/dashboard", roles: DASHBOARD_ROLES },
  { label: "Agenda", hint: "Ver agendamentos", icon: CalendarDays, href: "/agenda" },
  { label: "Financeiro", hint: "Receitas e despesas", icon: Wallet, href: "/financeiro", roles: FINANCIAL_ROLES },
  { label: "Relatórios", hint: "Exportar e comparar", icon: FileBarChart, href: "/relatorios", roles: FINANCIAL_ROLES },
  { label: "Serviços", hint: "Catálogo de serviços", icon: Scissors, href: "/servicos" },
  { label: "Produtos", hint: "Estoque e vendas", icon: ShoppingBag, href: "/produtos", roles: MANAGEMENT_ROLES },
  { label: "Pacotes & Planos", hint: "Receita recorrente", icon: Layers, href: "/pacotes", roles: MANAGEMENT_ROLES },
  { label: "Clientes", hint: "CRM", icon: Users, href: "/clientes" },
  { label: "Marketing", hint: "Campanhas", icon: Megaphone, href: "/marketing", roles: MARKETING_ROLES },
  { label: "Profissionais", hint: "Equipe e metas", icon: UserCog, href: "/profissionais" },
  { label: "Portfolio", hint: "Galeria de trabalhos", icon: ImageIcon, href: "/portfolio" },
  { label: "Configurações", hint: "Ajustes do salão", icon: Settings, href: "/configuracoes", roles: MANAGEMENT_ROLES },
];

export function CommandPalette({ role }: { role: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  const resultsId = useId();

  function setPaletteOpen(nextOpen: boolean) {
    openRef.current = nextOpen;
    setOpen(nextOpen);
  }

  // Atalho ⌘K / Ctrl+K — em telas sem teclado físico (celular/tablet), o
  // gatilho visível em OpenCommandPaletteButton dispara o mesmo evento.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) {
          setPaletteOpen(false);
          return;
        }
        requestCommandPaletteOpen(
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
        );
      }
    }
    function onOpenEvent(event: Event) {
      const request = event as CustomEvent<CommandPaletteOpenDetail>;

      // A sibling modal may cancel the request regardless of listener mount
      // order. Defer the decision until every synchronous listener has run.
      queueMicrotask(() => {
        if (request.defaultPrevented || openRef.current) return;
        const requestedTarget = request.detail?.returnFocusTo;
        const activeTarget = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
        returnFocusRef.current = requestedTarget?.isConnected
          ? requestedTarget
          : activeTarget?.isConnected
            ? activeTarget
            : null;
        setPaletteOpen(true);
      });
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
  }, [open]);

  const results = useMemo(() => {
    const allowed = COMMANDS.filter((c) => !c.roles || c.roles.includes(role));
    const s = q.trim().toLowerCase();
    if (!s) return allowed;
    return allowed.filter((c) => c.label.toLowerCase().includes(s) || c.hint.toLowerCase().includes(s));
  }, [q, role]);

  useEffect(() => {
    if (!open || !results[active]) return;
    document
      .getElementById(`${resultsId}-option-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open, results, resultsId]);

  function go(href: string) {
    window.dispatchEvent(
      new CustomEvent(COMMAND_PALETTE_NAVIGATE_EVENT, { detail: { href } }),
    );
    setPaletteOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active].href); }
  }

  return (
    <Dialog open={open} onOpenChange={setPaletteOpen}>
      <DialogContent
        className="top-[max(1rem,15dvh)] z-[100] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl border-border-strong bg-elevated p-0 pr-0 shadow-premium print:hidden"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const returnTarget = returnFocusRef.current;
          returnFocusRef.current = null;
          if (returnTarget?.isConnected) returnTarget.focus();
        }}
      >
        <DialogTitle className="sr-only">Navegação rápida</DialogTitle>
        <DialogDescription className="sr-only">
          Busque uma tela do painel e use as setas para escolher.
        </DialogDescription>
        <div className="flex items-center gap-3 border-b border-border py-1 pl-4 pr-14">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Buscar tela ou ação…"
            aria-label="Buscar tela ou ação"
            aria-controls={resultsId}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `${resultsId}-option-${active}` : undefined}
            role="combobox"
            className="h-12 flex-1 bg-transparent text-[14px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div id={resultsId} role="listbox" aria-label="Telas disponíveis" className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p role="option" aria-disabled="true" aria-selected="false" className="py-8 text-center text-[13px] text-muted-foreground">
              Nada encontrado.
            </p>
          ) : (
            results.map((c, i) => (
              <button
                key={c.href}
                id={`${resultsId}-option-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(c.href)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${i === active ? "bg-primary/10" : "hover:bg-card-hover"}`}
              >
                <span className={`grid h-8 w-8 place-items-center rounded-lg ${i === active ? "bg-primary/15 text-primary" : "bg-surface-1 text-muted-foreground"}`}>
                  <c.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{c.label}</p>
                  <p className="text-[11px] text-muted-foreground">{c.hint}</p>
                </div>
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Command className="h-3 w-3" /> Navegar rápido</span>
          <span>↑↓ mover · ↵ abrir</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Gatilho visível para abrir o CommandPalette — sem isso, quem não tem
 * teclado físico (celular/tablet) não descobre o atalho ⌘K/Ctrl+K de jeito
 * nenhum. Dispara um CustomEvent em vez de levantar estado entre irmãos
 * (CommandPalette é montado à parte, em (admin)/layout.tsx).
 */
export function OpenCommandPaletteButton() {
  const [shortcut, setShortcut] = useState<"⌘K" | "Ctrl K">("Ctrl K");

  useEffect(() => {
    setShortcut(commandShortcutLabel(navigator.platform));
  }, []);

  return (
    <button
      onClick={(event) => requestCommandPaletteOpen(event.currentTarget)}
      aria-haspopup="dialog"
      data-command-palette-trigger="true"
      className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-muted-foreground transition hover:border-border-strong hover:text-foreground"
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">Buscar</span>
      <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">{shortcut}</kbd>
    </button>
  );
}
