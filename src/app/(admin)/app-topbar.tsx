"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarPlus } from "lucide-react";
import { ProductWordmark } from "@/components/product-wordmark";
import { UnreadBadge } from "@/components/unread-badge";
import { useBusinessExperience } from "@/components/business-experience-provider";
import { OpenCommandPaletteButton } from "./command-palette";

const PAGE_LABELS: Record<string, string> = {
  "/dashboard": "Visão geral",
  "/agenda": "Agenda",
  "/notificacoes": "Notificações",
  "/servicos": "Serviços",
  "/produtos": "Produtos",
  "/pacotes": "Pacotes e planos",
  "/portfolio": "Portfólio",
  "/clientes": "Clientes",
  "/profissionais": "Equipe",
  "/financeiro": "Financeiro",
  "/relatorios": "Relatórios",
  "/marketing": "Marketing",
  "/compartilhar": "Página pública",
  "/configuracoes": "Configurações",
};

export function AppTopbar({
  salonName,
  unreadNotifications,
}: {
  salonName: string;
  unreadNotifications: number;
}) {
  const pathname = usePathname();
  const experience = useBusinessExperience();
  const route = Object.keys(PAGE_LABELS)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const pageLabel = route ? PAGE_LABELS[route] : "Workspace";

  return (
    <header className="app-topbar z-40 flex min-h-[4.5rem] shrink-0 items-center border-b border-border/70 px-4 sm:px-6 md:px-8 print:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProductWordmark compact className="md:hidden" />
        <div className="hidden min-w-0 md:block">
          <p className="experience-eyebrow text-[10px] font-semibold uppercase tracking-[0.17em]">
            {experience.shortLabel} · {salonName}
          </p>
          <p className="mt-0.5 truncate text-[14px] font-semibold tracking-tight">{pageLabel}</p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden w-64 lg:block">
          <OpenCommandPaletteButton />
        </div>
        <Link
          href="/notificacoes"
          aria-label={
            unreadNotifications > 0
              ? `${unreadNotifications} notificações não lidas`
              : "Notificações"
          }
          className="relative grid h-11 w-11 place-items-center rounded-xl border border-border bg-card/70 text-muted-foreground transition hover:border-border-strong hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell aria-hidden="true" className="h-4 w-4" />
          <UnreadBadge count={unreadNotifications} className="absolute -right-1 -top-1" />
        </Link>
        <Link
          href="/agenda"
          className="press-feedback inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[13px] font-semibold text-primary-foreground shadow-sm hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-4"
        >
          <CalendarPlus aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">Novo agendamento</span>
          <span className="sr-only sm:hidden">Abrir agenda para novo agendamento</span>
        </Link>
      </div>
    </header>
  );
}
