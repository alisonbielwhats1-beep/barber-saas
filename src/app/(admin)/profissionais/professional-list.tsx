"use client";
import { useState, type ReactNode } from "react";
import { MobileListTools } from "@/components/mobile-list-tools";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { normalizeImageUrl } from "@/lib/images";
import { contrastForeground } from "@/lib/color-contrast";

type Entry = { id: string; name: string; subtitle: string; active: boolean; avatarUrl: string | null; colorHex: string | null; content: ReactNode };
export function ProfessionalList({ entries, additionalTools }: { entries: Entry[]; additionalTools?: ReactNode }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find(entry => entry.id === selectedId);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const shown = entries.filter(entry => normalize(entry.name).includes(normalize(search.trim())));
  return <div className="min-w-0 space-y-3">
    <div className="admin-catalog-tools"><label className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring w-full md:max-w-sm"><Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /><input aria-label="Buscar profissional" placeholder="Buscar profissional…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>{additionalTools && <MobileListTools label="Indicadores da equipe">{additionalTools}</MobileListTools>}</div>
    <p role="status" className="sr-only">{shown.length} de {entries.length} profissionais</p>
    <div aria-label="Lista de profissionais" className="overflow-hidden">{shown.map(entry => {
      const color = entry.colorHex ?? "#2ECC8B";
      const initials = <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{background: color, color: contrastForeground(color)}}>{entry.name.split(" ").map(part => part[0]).slice(0, 2).join("")}</span>;
      const avatar = normalizeImageUrl(entry.avatarUrl);
      return <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id)} className="flex min-h-16 w-full items-center gap-3 border-b border-border/50 px-0 py-3 text-left last:border-0 hover:bg-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {avatar ? <ImageWithFallback src={avatar} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" fallback={initials}/> : initials}
        <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{entry.name}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{entry.subtitle}</span></span>
        <span className={`shrink-0 text-xs ${entry.active ? "text-success" : "text-muted-foreground"}`}>● {entry.active ? "Ativo" : "Inativo"}</span>
      </button>;
    })}</div>
    {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum profissional encontrado.</p>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}><DialogContent className="admin-professional-detail admin-form-dialog max-w-xl"><DialogHeader className="sr-only"><DialogTitle>Perfil de {selected?.name}</DialogTitle></DialogHeader>{selected?.content}</DialogContent></Dialog>
  </div>;
}
