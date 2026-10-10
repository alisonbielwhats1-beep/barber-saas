"use client";

import { useMemo, useState } from "react";
import {
  Cake,
  Check,
  Clock,
  Copy,
  Crown,
  MessageCircle,
  Search,
  Star,
  Ticket,
  UserPlus,
  Users,
} from "lucide-react";
import { recordCampaignInteraction } from "./actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Target = {
  id: string;
  name: string;
  phone: string | null;
  daysSince: number | null;
  favoriteService: string | null;
};

type Campaign = {
  key: string;
  title: string;
  /** Short name for the phone chips. */
  chip: string;
  icon: typeof Cake;
  description: string;
  template: string;
  targets: Target[];
};

type Props = {
  allClients: Target[];
  birthdays: Target[];
  lapsed: Target[];
  vips: Target[];
  attended: Target[];
  salonName: string;
  bookingUrl: string;
  googleReviewUrl: string | null;
  lapsedClientDays: number;
  enabled: boolean;
};

export function MarketingCampaigns({
  allClients,
  birthdays,
  lapsed,
  vips,
  attended,
  salonName,
  bookingUrl,
  googleReviewUrl,
  lapsedClientDays,
  enabled,
}: Props) {
  const campaigns: Campaign[] = [
    {
      key: "all",
      chip: "Todos",
      title: "Todos os clientes",
      icon: Users,
      description: "Envie um comunicado para clientes selecionados da base.",
      template: `Oi {nome}! Temos novidades no ${salonName}. Veja os horários e agende: {link} 💈`,
      targets: allClients,
    },
    {
      key: "lapsed",
      chip: "Sumidos",
      title: "Lembrete de sumidos",
      icon: Clock,
      description: `Reative quem não volta há ${lapsedClientDays} dias ou mais.`,
      template: `Oi {nome}, sentimos sua falta no ${salonName}! Já faz {dias} dias desde sua última visita. Que tal voltar para fazer {servico}? Agende aqui: {link} 💈`,
      targets: lapsed,
    },
    {
      key: "birthday",
      chip: "Aniversariantes",
      title: "Aniversariantes do mês",
      icon: Cake,
      description: "Parabenize e ofereça um motivo para o cliente voltar.",
      template: `Feliz aniversário, {nome}! 🎉 Você ganhou {cupom} neste mês no ${salonName}. Escolha seu horário: {link}`,
      targets: birthdays,
    },
    {
      key: "review",
      chip: "Avaliação",
      title: "Pedir avaliação",
      icon: Star,
      description: googleReviewUrl ? "Leve clientes atendidos direto à avaliação no Google." : "Peça feedback depois de atendimentos concluídos.",
      template: googleReviewUrl
        ? `Oi {nome}! Como foi sua experiência no ${salonName}? Sua avaliação ajuda outras pessoas a conhecerem nosso trabalho: {avaliacao} ⭐`
        : `Oi {nome}! Como foi sua experiência no ${salonName}? Responda com uma nota de 1 a 5. Sua opinião ajuda muito! ⭐`,
      targets: attended,
    },
    {
      key: "referral",
      chip: "Indicação",
      title: "Programa de indicação",
      icon: UserPlus,
      description: "Convide clientes fiéis a compartilhar o agendamento.",
      template: `{nome}, gostou do atendimento no ${salonName}? Compartilhe nosso link com alguém especial: {link} 🤝`,
      targets: vips,
    },
    {
      key: "vip",
      chip: "VIPs",
      title: "Novidades para VIPs",
      icon: Crown,
      description: "Ofereça exclusividade aos seus melhores clientes.",
      template: `{nome}, você é cliente VIP do ${salonName}! Temos novidades esperando por você. Reserve seu próximo horário: {link} ✨`,
      targets: vips,
    },
  ];

  const [active, setActive] = useState("lapsed");
  const [templates, setTemplates] = useState<Record<string, string>>(() =>
    Object.fromEntries(campaigns.map((campaign) => [campaign.key, campaign.template])),
  );
  const [coupon, setCoupon] = useState("20% OFF");
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedByCampaign, setSelectedByCampaign] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(campaigns.map((campaign) => [campaign.key, campaign.targets.map((target) => target.id)])),
  );

  const current = campaigns.find((campaign) => campaign.key === active) ?? campaigns[0];
  const selected = useMemo(() => new Set(selectedByCampaign[active] ?? []), [active, selectedByCampaign]);
  const shownTargets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return current.targets.filter((target) =>
      !query
      || target.name.toLowerCase().includes(query)
      || (target.phone ?? "").includes(query)
      || (target.favoriteService ?? "").toLowerCase().includes(query),
    );
  }, [current.targets, search]);

  function render(target: Target) {
    return templates[active]
      .replace(/\{nome\}/g, target.name.split(" ")[0])
      .replace(/\{cupom\}/g, coupon)
      .replace(/\{dias\}/g, target.daysSince?.toString() ?? lapsedClientDays.toString())
      .replace(/\{servico\}/g, target.favoriteService ?? "seu serviço favorito")
      .replace(/\{link\}/g, bookingUrl)
      .replace(/\{avaliacao\}/g, googleReviewUrl ?? bookingUrl);
  }

  function waLink(target: Target) {
    const digits = (target.phone ?? "").replace(/\D/g, "");
    const full = digits.length <= 11 ? `55${digits}` : digits;
    return `https://wa.me/${full}?text=${encodeURIComponent(render(target))}`;
  }

  async function copyMsg(target: Target) {
    if (!enabled) return;
    await navigator.clipboard.writeText(render(target));
    void recordCampaignInteraction({ campaignKey: active, clientId: target.id, status: "COPIED" });
    setCopied(target.id);
    setTimeout(() => setCopied(null), 1500);
  }

  function toggleTarget(id: string) {
    setSelectedByCampaign((previous) => {
      const ids = new Set(previous[active] ?? []);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { ...previous, [active]: [...ids] };
    });
  }

  function selectTargets(ids: string[]) {
    setSelectedByCampaign((previous) => ({ ...previous, [active]: ids }));
  }

  const initials = (name: string) => name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="lg:hidden">
          <div role="group" aria-label="Escolher campanha" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
            {campaigns.map((campaign) => (
              <button
                key={campaign.key}
                type="button"
                aria-pressed={active === campaign.key}
                onClick={() => setActive(campaign.key)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] border px-3.5 text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active === campaign.key ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border-strong font-medium text-foreground hover:bg-card-hover",
                )}
              >
                {campaign.chip} · {campaign.targets.length}
              </button>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-border-strong bg-card px-3.5 py-3">
            <p className="text-sm font-semibold">{current.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{current.description}</p>
          </div>
        </div>

        <div className="hidden space-y-2 lg:block">
          {campaigns.map((campaign) => (
            <button
              key={campaign.key}
              type="button"
              aria-pressed={active === campaign.key}
              onClick={() => setActive(campaign.key)}
              className={cn(
                "flex w-full flex-col gap-2 rounded-[14px] border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active === campaign.key ? "border-border-strong bg-[hsl(var(--border))] shadow-[inset_0_0_0_1px_hsl(var(--border-strong))]" : "border-border bg-card hover:bg-card-hover",
              )}
            >
              <span className="flex items-center gap-3">
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground"><campaign.icon aria-hidden="true" className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{campaign.title}</span><span className="block text-xs tabular-nums text-muted-foreground">{campaign.targets.length} {campaign.targets.length === 1 ? "cliente" : "clientes"}</span></span>
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{campaign.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="space-y-3 rounded-[14px] border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Mensagem</h3>
            <label className="flex h-11 items-center gap-1.5 rounded-full border border-border-strong bg-card px-2.5 lg:h-9">
              <Ticket aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
              <input aria-label="Benefício informado na mensagem" value={coupon} onChange={(event) => setCoupon(event.target.value)} className="w-[84px] bg-transparent text-base focus:outline-none lg:text-sm" placeholder="Cupom" />
            </label>
          </div>
          <textarea aria-label="Mensagem da campanha" disabled={!enabled} value={templates[active]} onChange={(event) => setTemplates((previous) => ({ ...previous, [active]: event.target.value }))} rows={4} className="block h-[150px] w-full resize-none rounded-[10px] border border-border-strong bg-background px-3 py-2.5 text-base leading-relaxed focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60 lg:h-[108px] lg:text-sm" />
          <p className="text-xs leading-relaxed text-muted-foreground">O benefício é comunicado por mensagem; o desconto deve ser aplicado pela equipe no fechamento. Não há aplicação automática de cupom. Personalize com {"{nome}"}, {"{cupom}"}, {"{dias}"}, {"{servico}"}, {"{link}"} e {"{avaliacao}"}.</p>
          <a href="#marketing-destinatarios" className={cn(buttonVariants(), "w-full tabular-nums lg:hidden")}><Users aria-hidden="true" className="h-4 w-4" /> Ver destinatários ({current.targets.length})</a>
        </div>

        <div id="marketing-destinatarios" className="scroll-mt-4 overflow-hidden rounded-[14px] border border-border bg-card">
          <div className="space-y-2.5 border-b border-border px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-sm font-semibold tabular-nums">{selected.size} de {current.targets.length} destinatários selecionados</span>
              <span className="flex text-sm font-medium"><button type="button" disabled={!enabled} onClick={() => selectTargets(current.targets.map((target) => target.id))} className="min-h-11 rounded-lg px-2 text-foreground hover:underline disabled:opacity-40 lg:min-h-8">Todos</button><button type="button" disabled={!enabled} onClick={() => selectTargets([])} className="min-h-11 rounded-lg px-2 text-muted-foreground hover:text-foreground hover:underline disabled:opacity-40 lg:min-h-8">Nenhum</button></span>
            </div>
            <label className="flex h-11 items-center gap-2.5 rounded-[10px] border border-border-strong bg-card px-3 text-muted-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25 lg:h-9"><Search aria-hidden="true" className="h-4 w-4 shrink-0" /><input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" aria-label="Buscar destinatário" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, telefone ou serviço" className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground lg:text-sm" /></label>
          </div>

          {current.targets.length === 0 ? (
            <p className="p-7 text-center text-sm text-muted-foreground">Nenhum cliente neste segmento agora.</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              {shownTargets.map((target) => (
                <div key={target.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3.5 py-2.5 last:border-0 sm:flex-nowrap">
                  <input disabled={!enabled} type="checkbox" checked={selected.has(target.id)} onChange={() => toggleTarget(target.id)} aria-label={`Selecionar ${target.name}`} className="h-5 w-5 shrink-0 accent-[hsl(var(--selection-solid))]" />
                  <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{initials(target.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">{target.name}</p>
                    <p className="text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">{target.phone ?? "sem telefone"}{target.daysSince != null ? ` · ${target.daysSince}d sem visitar` : ""}{target.favoriteService ? ` · ${target.favoriteService}` : ""}</p>
                  </div>
                  <div className="flex basis-full gap-2 pl-[76px] sm:basis-auto sm:pl-0">
                    <button type="button" onClick={() => copyMsg(target)} disabled={!enabled || !selected.has(target.id)} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-medium text-foreground transition-colors hover:bg-card-hover disabled:opacity-40 sm:px-0 lg:min-h-9 lg:min-w-9" title="Copiar mensagem">{copied === target.id ? <Check aria-hidden="true" className="h-4 w-4 text-success" /> : <Copy aria-hidden="true" className="h-4 w-4" />}<span className="sm:hidden">{copied === target.id ? "Copiado" : "Copiar"}</span></button>
                    {target.phone ? (
                      <a
                        href={enabled && selected.has(target.id) ? waLink(target) : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!enabled || !selected.has(target.id)}
                        onClick={(event) => {
                          if (!enabled || !selected.has(target.id)) { event.preventDefault(); return; }
                          void recordCampaignInteraction({ campaignKey: active, clientId: target.id, status: "OPENED" });
                        }}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong bg-muted px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover aria-disabled:pointer-events-none aria-disabled:opacity-40 sm:flex-none lg:min-h-9"
                      ><MessageCircle aria-hidden="true" className="h-4 w-4" /><span className="sm:hidden">Enviar pelo WhatsApp</span><span className="hidden sm:inline">Enviar</span></a>
                    ) : <span className="inline-flex min-h-[22px] flex-1 items-center justify-center self-center rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground sm:flex-none">Sem WhatsApp</span>}
                  </div>
                </div>
              ))}
              {shownTargets.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">Nenhum destinatário encontrado para esta busca.</p>}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{enabled ? "Cada ação abre ou copia a mensagem para revisão. Nada é disparado automaticamente." : "Contrate um plano pago para liberar as ações de campanha. Nada é disparado automaticamente."}</p>
      </div>
    </div>
  );
}
