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
  icon: typeof Cake;
  accent: string;
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
      title: "Todos os clientes",
      icon: Users,
      accent: "#10B981",
      description: "Envie um comunicado para clientes selecionados da base.",
      template: `Oi {nome}! Temos novidades no ${salonName}. Veja os horários e agende: {link} 💈`,
      targets: allClients,
    },
    {
      key: "lapsed",
      title: "Lembrete de sumidos",
      icon: Clock,
      accent: "#EF4444",
      description: `Reative quem não volta há ${lapsedClientDays} dias ou mais.`,
      template: `Oi {nome}, sentimos sua falta no ${salonName}! Já faz {dias} dias desde sua última visita. Que tal voltar para fazer {servico}? Agende aqui: {link} 💈`,
      targets: lapsed,
    },
    {
      key: "birthday",
      title: "Aniversariantes do mês",
      icon: Cake,
      accent: "#EC4899",
      description: "Parabenize e ofereça um motivo para o cliente voltar.",
      template: `Feliz aniversário, {nome}! 🎉 Você ganhou {cupom} neste mês no ${salonName}. Escolha seu horário: {link}`,
      targets: birthdays,
    },
    {
      key: "review",
      title: "Pedir avaliação",
      icon: Star,
      accent: "#A855F7",
      description: googleReviewUrl ? "Leve clientes atendidos direto à avaliação no Google." : "Peça feedback depois de atendimentos concluídos.",
      template: googleReviewUrl
        ? `Oi {nome}! Como foi sua experiência no ${salonName}? Sua avaliação ajuda outras pessoas a conhecerem nosso trabalho: {avaliacao} ⭐`
        : `Oi {nome}! Como foi sua experiência no ${salonName}? Responda com uma nota de 1 a 5. Sua opinião ajuda muito! ⭐`,
      targets: attended,
    },
    {
      key: "referral",
      title: "Programa de indicação",
      icon: UserPlus,
      accent: "#3B9EFF",
      description: "Convide clientes fiéis a compartilhar o agendamento.",
      template: `{nome}, gostou do atendimento no ${salonName}? Compartilhe nosso link com alguém especial: {link} 🤝`,
      targets: vips,
    },
    {
      key: "vip",
      title: "Novidades para VIPs",
      icon: Crown,
      accent: "#F4C430",
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

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <div className="lg:hidden">
          <label htmlFor="mobile-campaign" className="mb-2 block text-[12px] font-semibold">Escolha a campanha</label>
          <select
            id="mobile-campaign"
            aria-label="Escolher campanha"
            value={active}
            onChange={(event) => setActive(event.target.value)}
            className="h-12 w-full rounded-xl border border-border bg-card px-3 text-[14px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {campaigns.map((campaign) => <option key={campaign.key} value={campaign.key}>{campaign.title} ({campaign.targets.length})</option>)}
          </select>
          <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
            <p className="text-[12px] font-semibold">{current.title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{current.description}</p>
          </div>
        </div>

        <div className="hidden space-y-2 lg:block">
          {campaigns.map((campaign) => (
            <button
              key={campaign.key}
              onClick={() => setActive(campaign.key)}
              className={`w-full rounded-2xl border p-4 text-left transition ${active === campaign.key ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:bg-card-hover"}`}
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${campaign.accent}1f`, color: campaign.accent }}><campaign.icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">{campaign.title}</p><p className="text-[11px] text-muted-foreground">{campaign.targets.length} clientes</p></div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{campaign.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold">Mensagem</h3>
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1">
              <Ticket className="h-3.5 w-3.5 text-primary" />
              <input value={coupon} onChange={(event) => setCoupon(event.target.value)} className="w-20 bg-transparent text-[12px] focus:outline-none" placeholder="Cupom" />
            </div>
          </div>
          <textarea disabled={!enabled} value={templates[active]} onChange={(event) => setTemplates((previous) => ({ ...previous, [active]: event.target.value }))} rows={4} className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60" />
          <p className="mt-2 text-[11px] text-muted-foreground">Personalize com {"{nome}"}, {"{cupom}"}, {"{dias}"}, {"{servico}"}, {"{link}"} e {"{avaliacao}"}.</p>
          <a href="#marketing-destinatarios" className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground lg:hidden"><Users className="h-4 w-4" /> Ver destinatários ({current.targets.length})</a>
        </div>

        <div id="marketing-destinatarios" className="scroll-mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="space-y-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold">
              <span>{selected.size} de {current.targets.length} destinatários selecionados</span>
              <span className="flex gap-3 text-[11px] font-medium"><button disabled={!enabled} onClick={() => selectTargets(current.targets.map((target) => target.id))} className="min-h-11 text-primary disabled:opacity-40">Todos</button><button disabled={!enabled} onClick={() => selectTargets([])} className="min-h-11 text-muted-foreground disabled:opacity-40">Nenhum</button></span>
            </div>
            <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-background px-3"><Search className="h-3.5 w-3.5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, telefone ou serviço" className="w-full bg-transparent text-[12px] outline-none" /></div>
          </div>

          {current.targets.length === 0 ? (
            <p className="p-8 text-center text-[13px] text-muted-foreground">Nenhum cliente neste segmento agora.</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              {shownTargets.map((target) => (
                <div key={target.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:flex-nowrap sm:px-5">
                  <input disabled={!enabled} type="checkbox" checked={selected.has(target.id)} onChange={() => toggleTarget(target.id)} aria-label={`Selecionar ${target.name}`} className="h-4 w-4 accent-primary" />
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-1 text-[11px] font-semibold">{target.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{target.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{target.phone ?? "sem telefone"}{target.daysSince != null ? ` · ${target.daysSince}d sem visitar` : ""}{target.favoriteService ? ` · ${target.favoriteService}` : ""}</p>
                  </div>
                  <div className="flex basis-full gap-2 pl-12 sm:basis-auto sm:pl-0">
                    <button onClick={() => copyMsg(target)} disabled={!enabled || !selected.has(target.id)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-muted-foreground disabled:opacity-35" title="Copiar mensagem">{copied === target.id ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}<span className="sm:hidden">{copied === target.id ? "Copiado" : "Copiar"}</span></button>
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
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#25D366]/15 px-3 text-[12px] font-medium text-[#25D366] aria-disabled:pointer-events-none aria-disabled:opacity-35 sm:flex-none"
                      ><MessageCircle className="h-3.5 w-3.5" /><span className="sm:hidden">Enviar pelo WhatsApp</span><span className="hidden sm:inline">Enviar</span></a>
                    ) : <span className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-surface-1 px-3 text-[11px] text-muted-foreground sm:flex-none">Sem WhatsApp</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{enabled ? "Cada ação abre ou copia a mensagem para revisão. Nada é disparado automaticamente." : "Faça upgrade para liberar as ações de campanha. Nada é disparado automaticamente."}</p>
      </div>
    </div>
  );
}
