"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, Scissors, ShoppingBag, Layers, Image as ImageIcon,
  Users, UserCog, Wallet, FileBarChart, Megaphone, Settings, Search, CornerDownLeft, Command,
} from "lucide-react";

type Cmd = { label: string; hint: string; icon: typeof Search; href: string };

const COMMANDS: Cmd[] = [
  { label: "Dashboard", hint: "Visão geral", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Agenda", hint: "Ver agendamentos", icon: CalendarDays, href: "/agenda" },
  { label: "Financeiro", hint: "Receitas e despesas", icon: Wallet, href: "/financeiro" },
  { label: "Relatórios", hint: "Exportar e comparar", icon: FileBarChart, href: "/relatorios" },
  { label: "Serviços", hint: "Catálogo de serviços", icon: Scissors, href: "/servicos" },
  { label: "Produtos", hint: "Estoque e vendas", icon: ShoppingBag, href: "/produtos" },
  { label: "Pacotes & Planos", hint: "Receita recorrente", icon: Layers, href: "/pacotes" },
  { label: "Clientes", hint: "CRM", icon: Users, href: "/clientes" },
  { label: "Marketing", hint: "Campanhas", icon: Megaphone, href: "/marketing" },
  { label: "Profissionais", hint: "Equipe e metas", icon: UserCog, href: "/profissionais" },
  { label: "Portfolio", hint: "Galeria de trabalhos", icon: ImageIcon, href: "/portfolio" },
  { label: "Configurações", hint: "Ajustes do salão", icon: Settings, href: "/configuracoes" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Atalho ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(s) || c.hint.toLowerCase().includes(s));
  }, [q]);

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
