"use client";

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, CalendarClock, ChevronLeft, ChevronRight, Crown, DoorClosed, ListChecks, Palette, Search, ShieldCheck, SlidersHorizontal, UserRound, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "aparencia", label: "Aparência e vitrine", detail: "Logo, capa, cores e informações públicas", group: "Meu estabelecimento", keywords: "marca foto instagram whatsapp pagamento", icon: Palette },
  { id: "agenda", label: "Dados e regras de agendamento", detail: "Contato, antecedência, intervalos e cancelamento", group: "Meu estabelecimento", keywords: "nome endereço telefone moeda fuso politica", icon: SlidersHorizontal },
  { id: "horarios", label: "Horários de funcionamento", detail: "Expediente do salão e jornada da equipe", group: "Agenda e atendimento", keywords: "horario pausa abertura fechamento profissional", icon: CalendarClock },
  { id: "precos", label: "Preços por dia", detail: "Acréscimos por dia da semana ou data especial", group: "Agenda e atendimento", keywords: "valor feriado preço tarifa", icon: Wallet },
  { id: "fechamentos", label: "Fechamentos do salão", detail: "Dias e períodos sem atendimento", group: "Agenda e atendimento", keywords: "bloqueio folga ferias fechar", icon: DoorClosed },
  { id: "perfil", label: "Meu perfil", detail: "Nome, e-mail e dados pessoais", group: "Conta e acesso", keywords: "usuario avatar foto telefone", icon: UserRound },
  { id: "seguranca", label: "Segurança e acessos", detail: "Equipe, permissões e convites", group: "Conta e acesso", keywords: "acesso gerente recepcao membro convite", icon: ShieldCheck },
  { id: "notificacoes", label: "Notificações", detail: "Central de avisos e atualizações", group: "Conta e acesso", keywords: "lembrete alerta mensagem", icon: Bell },
  { id: "plano", label: "Meu plano", detail: "Assinatura, recursos e cancelamento da renovação", group: "Conta e acesso", keywords: "assinatura faturamento cancelar cobrança recorrente", icon: Crown },
  { id: "primeiros-passos", label: "Primeiros passos", detail: "Confira o que falta configurar", group: "Conta e acesso", keywords: "checklist iniciar cadastro", icon: ListChecks },
];
/** On the computer the list sits beside the open section; with nothing chosen, the first one is shown. */
const FALLBACK = SECTIONS[0];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

/**
 * Preserve mounted forms when returning to search, including unsaved edits.
 * Phone and tablet: list, then one section (with "Todas as configurações").
 * Computer (lg): list on the left and the section on the right.
 */
export function SettingsSectionNav({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const titleBlock = useRef<HTMLDivElement>(null);
  const lastLink = useRef<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      const id = hash === "jornadas" ? "horarios" : hash;
      setActive(SECTIONS.some(section => section.id === id) ? id : null);
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);

  useEffect(() => {
    // Focus without the browser's jump (it would hide the title under the top bar); then bring it into view only if needed.
    if (active) { heading.current?.focus({ preventScroll: true }); titleBlock.current?.scrollIntoView?.({ block: "nearest" }); }
    else if (lastLink.current) document.getElementById(`settings-link-${lastLink.current}`)?.focus();
  }, [active]);

  function navigate(id: string | null) {
    if (id) lastLink.current = id;
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${id ? `#${id}` : ""}`);
    setActive(id);
  }

  const selected = SECTIONS.find(section => section.id === active);
  const shown = selected ?? FALLBACK;
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = SECTIONS.filter(section => terms.every(term => normalize(`${section.label} ${section.detail} ${section.keywords} ${section.group}`).includes(term)));

  return <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-6 xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-7">
    <div className={cn("space-y-[18px] lg:sticky lg:top-[72px] lg:space-y-3.5", selected && "hidden lg:block")}>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input ref={search} type="search" aria-label="Buscar configuração" placeholder="Buscar configuração" value={query} onChange={event => setQuery(event.target.value)} className="h-11 w-full rounded-[10px] border border-border-strong bg-card pl-10 pr-11 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 lg:h-9 lg:pr-9 lg:text-sm [&::-webkit-search-cancel-button]:hidden" />
        {query && <button type="button" aria-label="Limpar busca" onClick={() => { setQuery(""); search.current?.focus(); }} className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9 lg:w-9"><X aria-hidden="true" className="h-4 w-4" /></button>}
      </div>
      {query && <p role="status" className="text-sm text-muted-foreground">{matches.length ? `${matches.length} ${matches.length === 1 ? "opção encontrada" : "opções encontradas"}` : "Nenhuma configuração encontrada. Tente buscar por horário, preço ou perfil."}</p>}
      <nav aria-label="Seções de configurações" className="space-y-[18px] lg:space-y-3.5">
        {[...new Set(matches.map(section => section.group))].map(group => <section key={group}>
          <h2 className="mx-0.5 mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{group}</h2>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            {matches.filter(section => section.group === group).map(({ id, label, detail, icon: Icon }) => {
              const current = id === active;
              const fallback = !active && id === FALLBACK.id;
              return <a key={id} id={`settings-link-${id}`} href={`#${id}`} aria-current={current || fallback ? "true" : undefined} onClick={event => { event.preventDefault(); navigate(id); }}
                className={cn(
                  "group flex min-h-[60px] items-center gap-3 border-b border-border px-3.5 py-2 transition-colors last:border-b-0 hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:min-h-[42px] lg:gap-2.5 lg:px-3 lg:py-1.5",
                  current && "lg:bg-[hsl(var(--border))] lg:hover:bg-[hsl(var(--border))]",
                  fallback && "lg:bg-[hsl(var(--border))] lg:hover:bg-[hsl(var(--border))]",
                )}>
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground lg:h-7 lg:w-7 lg:rounded-lg"><Icon aria-hidden="true" className="h-[17px] w-[17px] lg:h-3.5 lg:w-3.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">{label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground lg:sr-only">{detail}</span>
                </span>
                <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </a>;
            })}
          </div>
        </section>)}
      </nav>
    </div>
    <div className="min-w-0 lg:max-w-[760px]">
      <div ref={titleBlock} className={cn("mb-3.5 scroll-mt-24 lg:mb-4", !selected && "hidden lg:block")}>
        {selected && <button type="button" onClick={() => navigate(null)} className="-ml-1 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg pr-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8 lg:text-muted-foreground lg:hover:text-foreground"><ChevronLeft aria-hidden="true" className="h-[18px] w-[18px] lg:h-4 lg:w-4" />Todas as configurações</button>}
        <h2 ref={heading} tabIndex={-1} className="text-base font-semibold tracking-[-0.01em] outline-none">{shown.label}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{shown.detail}</p>
      </div>
      {query && selected && !matches.some(section => section.id === active) && <p className="mb-3 hidden text-xs text-muted-foreground lg:block">A seção aberta não aparece na busca, mas continua aqui.</p>}
      {Children.map(children, child => {
        if (!isValidElement<{ id?: string }>(child)) return null;
        const id = child.props.id;
        const fallback = !active && id === FALLBACK.id;
        return <div hidden={id !== active && !fallback} className={fallback ? "hidden lg:block" : undefined}>{child}</div>;
      })}
    </div>
  </div>;
}
