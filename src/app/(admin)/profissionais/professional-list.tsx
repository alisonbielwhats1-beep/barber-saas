"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { normalizeImageUrl } from "@/lib/images";
import { contrastForeground } from "@/lib/color-contrast";
import { cn } from "@/lib/utils";

type Entry = {
  id: string;
  name: string;
  subtitle: string;
  active: boolean;
  avatarUrl: string | null;
  colorHex: string | null;
  /** Corpo do cartão (meta, atendimentos, comissão e expediente de hoje). */
  card: ReactNode;
  /** Agenda do profissional; só para quem está ativo. */
  agendaHref: string | null;
  /** Conteúdo da janela "Perfil de …". */
  content: ReactNode;
};

export function ProfessionalAvatar({ name, avatarUrl, colorHex, size }: { name: string; avatarUrl: string | null; colorHex: string | null; size: number }) {
  const color = colorHex ?? "#2ECC8B";
  const initials = (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ height: size, width: size, fontSize: size >= 44 ? 16 : 12, background: color, color: contrastForeground(color) }}
    >
      {name.split(" ").map(part => part[0]).slice(0, 2).join("")}
    </span>
  );
  const avatar = normalizeImageUrl(avatarUrl);
  return avatar
    ? <ImageWithFallback src={avatar} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ height: size, width: size }} fallback={initials} />
    : initials;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex min-h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${active ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? "bg-success" : "bg-muted-foreground"}`} />
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}

export function ProfessionalList({
  entries,
  indicators,
  periodLabel,
  addAction,
  canManage = false,
  searchable = true,
}: {
  entries: Entry[];
  /** Cartões de indicadores: abertos no computador, recolhidos no celular. */
  indicators?: ReactNode;
  periodLabel?: string;
  /** Botão "Adicionar" ao lado da busca, só no celular. */
  addAction?: ReactNode;
  canManage?: boolean;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIndicators, setShowIndicators] = useState(false);
  const selected = entries.find(entry => entry.id === selectedId);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const shown = entries.filter(entry => normalize(entry.name).includes(normalize(search.trim())));
  return <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
    {searchable && <div className="order-1 flex min-w-0 items-center gap-2 lg:order-2">
      <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-border-strong bg-card px-3 text-muted-foreground focus-within:border-ring lg:h-9 lg:w-72 lg:flex-none">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
        <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" aria-label="Buscar profissional" placeholder="Buscar profissional" value={search} onChange={e => setSearch(e.target.value)} className="h-full w-full min-w-0 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none lg:text-sm" />
      </label>
      {addAction}
    </div>}

    {indicators && (
      <section aria-label="Indicadores da equipe" className="order-2 min-w-0 overflow-hidden rounded-[14px] border border-border bg-card lg:order-1 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">
        <button
          type="button"
          aria-expanded={showIndicators}
          onClick={() => setShowIndicators(open => !open)}
          className="flex min-h-[54px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:hidden"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Indicadores da equipe</span>
            {periodLabel && <span className="mt-0.5 block text-sm text-muted-foreground">{periodLabel}</span>}
          </span>
          <ChevronDown aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 text-muted-foreground transition-transform ${showIndicators ? "rotate-180" : ""}`} />
        </button>
        <div className={cn(showIndicators ? "block" : "hidden", "border-t border-border p-3 lg:block lg:border-0 lg:p-0")}>{indicators}</div>
      </section>
    )}

    <div className="order-3 min-w-0">
      <p role="status" className="sr-only">{shown.length} de {entries.length} profissionais</p>
      <div aria-label="Lista de profissionais" className="grid min-w-0 gap-3 lg:grid-cols-2 lg:gap-4">{shown.map(entry => {
        const firstName = entry.name.split(" ")[0] ?? entry.name;
        return <article key={entry.id} aria-label={`Profissional ${entry.name}`} className="flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4">
          <button type="button" aria-label={`Abrir perfil de ${entry.name}`} onClick={() => setSelectedId(entry.id)} className="-m-1.5 flex min-w-0 items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className={entry.active ? "" : "opacity-60 grayscale"}><ProfessionalAvatar name={entry.name} avatarUrl={entry.avatarUrl} colorHex={entry.colorHex} size={48} /></span>
            <span className="min-w-0 flex-1">
              <span className={`block break-words text-sm font-semibold ${entry.active ? "text-foreground" : "text-muted-foreground"}`}>{entry.name}</span>
              <span className="mt-0.5 block break-words text-xs text-muted-foreground">{entry.subtitle}</span>
            </span>
            <ActiveBadge active={entry.active} />
          </button>
          {entry.card}
          <div className="mt-auto grid gap-2 sm:grid-cols-2">
            {entry.agendaHref && (
              <Link href={entry.agendaHref} className={cn(buttonVariants({ variant: "outline" }), "min-w-0 px-3")}>
                <CalendarDays aria-hidden="true" className="h-4 w-4" />
                <span className="truncate">Ver agenda de {firstName}</span>
              </Link>
            )}
            <Button type="button" variant="secondary" onClick={() => setSelectedId(entry.id)} className={cn("min-w-0 px-3", !entry.agendaHref && "sm:col-span-2")}>
              {canManage ? "Perfil e ações" : "Ver perfil"}
            </Button>
          </div>
        </article>;
      })}</div>
      {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum profissional encontrado.</p>}
    </div>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}><DialogContent className="admin-professional-detail admin-form-dialog max-w-xl"><DialogHeader className="sr-only"><DialogTitle>Perfil de {selected?.name}</DialogTitle></DialogHeader>{selected?.content}</DialogContent></Dialog>
  </div>;
}
