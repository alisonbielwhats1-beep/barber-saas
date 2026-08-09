"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { useBusinessExperience } from "@/components/business-experience-provider";

type Cmd = { label: string; hint: string; icon: typeof Search; href: string; roles?: readonly string[] };

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
  const experience = useBusinessExperience();

  // Atalho ⌘K / Ctrl+K — em telas sem teclado físico (celular/tablet), o
  // gatilho visível em OpenCommandPaletteButton dispara o mesmo evento.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo(() => {
    const allowed = COMMANDS.filter((c) => !c.roles || c.roles.includes(role)).map((command) => {
      if (command.href === "/profissionais") {
        return {
          ...command,
          label: experience.navigation.professionals,
          hint: `Equipe de ${experience.terminology.professionals}`,
        };
      }
      if (command.href === "/servicos") {
        return {
          ...command,
          label: experience.navigation.services,
          hint: `Catálogo de ${experience.terminology.services}`,
        };
      }
      if (command.href === "/configuracoes") {
        return { ...command, hint: "Ajustes do estabelecimento" };
      }
      return command;
    });
    const s = q.trim().toLowerCase();
    if (!s) return allowed;
    return allowed.filter((c) => c.label.toLowerCase().includes(s) || c.hint.toLowerCase().includes(s));
  }, [experience, q, role]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active].href); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] print:hidden" onMouseDown={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border-strong bg-elevated shadow-premium animate-scale-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Buscar tela ou ação…"
            className="h-12 flex-1 bg-transparent text-[14px] placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Nada encontrado.</p>
          ) : (
            results.map((c, i) => (
              <button
                key={c.href}
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
      </div>
    </div>
  );
}

/**
 * Gatilho visível para abrir o CommandPalette — sem isso, quem não tem
 * teclado físico (celular/tablet) não descobre o atalho ⌘K/Ctrl+K de jeito
 * nenhum. Dispara um CustomEvent em vez de levantar estado entre irmãos
 * (CommandPalette é montado à parte, em (admin)/layout.tsx).
 */
export function OpenCommandPaletteButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      aria-label="Abrir busca rápida"
      className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] text-muted-foreground transition hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">Buscar</span>
      <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">⌘K</kbd>
    </button>
  );
}
