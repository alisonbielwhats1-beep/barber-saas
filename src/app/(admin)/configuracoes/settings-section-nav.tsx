"use client";

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bell, CalendarClock, ChevronRight, Crown, DoorClosed, ListChecks, Palette, Search, ShieldCheck, SlidersHorizontal, UserRound, Wallet, X } from "lucide-react";

const SECTIONS = [
  { id: "aparencia", label: "Aparência e vitrine", detail: "Logo, capa, cores e informações públicas", group: "Meu estabelecimento", keywords: "marca foto instagram whatsapp pagamento", icon: Palette },
  { id: "agenda", label: "Dados e regras de agendamento", detail: "Contato, antecedência, intervalos e cancelamento", group: "Meu estabelecimento", keywords: "nome endereço telefone moeda fuso politica", icon: SlidersHorizontal },
  { id: "horarios", label: "Horários de funcionamento", detail: "Expediente do salão e jornada da equipe", group: "Agenda e atendimento", keywords: "horario pausa abertura fechamento profissional", icon: CalendarClock },
  { id: "precos", label: "Preços por dia", detail: "Acréscimos por dia da semana ou data especial", group: "Agenda e atendimento", keywords: "valor feriado preço tarifa", icon: Wallet },
  { id: "fechamentos", label: "Fechamentos do salão", detail: "Dias e períodos sem atendimento", group: "Agenda e atendimento", keywords: "bloqueio folga ferias fechar", icon: DoorClosed },
  { id: "perfil", label: "Meu perfil", detail: "Nome, e-mail e dados pessoais", group: "Conta e acesso", keywords: "usuario avatar foto telefone", icon: UserRound },
  { id: "seguranca", label: "Segurança e acessos", detail: "Equipe, permissões e convites", group: "Conta e acesso", keywords: "acesso gerente recepcao membro convite", icon: ShieldCheck },
  { id: "notificacoes", label: "Notificações", detail: "Central de avisos e atualizações", group: "Conta e acesso", keywords: "lembrete alerta mensagem", icon: Bell },
  { id: "plano", label: "Meu plano", detail: "Recursos e limites do plano atual", group: "Conta e acesso", keywords: "assinatura faturamento", icon: Crown },
  { id: "primeiros-passos", label: "Primeiros passos", detail: "Confira o que falta configurar", group: "Conta e acesso", keywords: "checklist iniciar cadastro", icon: ListChecks },
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

/** Preserve mounted forms when returning to search, including unsaved edits. */
export function SettingsSectionNav({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
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
    if (active) heading.current?.focus();
    else if (lastLink.current) document.getElementById(`settings-link-${lastLink.current}`)?.focus();
  }, [active]);

  function navigate(id: string | null) {
    if (id) lastLink.current = id;
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${id ? `#${id}` : ""}`);
    setActive(id);
  }

  const selected = SECTIONS.find(section => section.id === active);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = SECTIONS.filter(section => terms.every(term => normalize(`${section.label} ${section.detail} ${section.keywords} ${section.group}`).includes(term)));

  return <div>
    <div hidden={Boolean(active)}>
      <div className="relative mb-6">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-muted-foreground" />
        <input ref={search} type="search" aria-label="Buscar configuração" placeholder="Buscar configuração" value={query} onChange={event => setQuery(event.target.value)} className="min-h-12 w-full rounded-xl border border-border bg-card pl-11 pr-12 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        {query && <button type="button" aria-label="Limpar busca" onClick={() => { setQuery(""); search.current?.focus(); }} className="absolute right-0 top-0 grid h-12 w-12 place-items-center rounded-xl focus-visible:ring-2 focus-visible:ring-ring"><X aria-hidden="true" className="h-4 w-4" /></button>}
      </div>
      <nav aria-label="Seções de configurações" className="grid gap-6 lg:grid-cols-2">
        {[...new Set(matches.map(section => section.group))].map(group => <section key={group}>
          <h2 className="mb-2 text-sm font-semibold">{group}</h2>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {matches.filter(section => section.group === group).map(({ id, label, detail, icon: Icon }) => <a key={id} id={`settings-link-${id}`} href={`#${id}`} onClick={event => { event.preventDefault(); navigate(id); }} className="flex min-h-20 items-center gap-3 px-4 py-3 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{detail}</span></span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            </a>)}
          </div>
        </section>)}
      </nav>
      {query && <p role="status" className="mt-4 text-sm text-muted-foreground">{matches.length ? `${matches.length} opções encontradas` : "Nenhuma configuração encontrada. Tente buscar por horário, preço ou perfil."}</p>}
    </div>
    {selected && <div className="mb-5">
      <button type="button" onClick={() => navigate(null)} className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-lg pr-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Todas as configurações</button>
      <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">{selected.label}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{selected.detail}</p>
    </div>}
    {Children.map(children, child => isValidElement<{ id?: string }>(child) ? <div hidden={child.props.id !== active}>{child}</div> : null)}
  </div>;
}
