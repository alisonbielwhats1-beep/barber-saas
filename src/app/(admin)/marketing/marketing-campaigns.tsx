"use client";

import { useState } from "react";
import { Cake, Clock, Crown, MessageCircle, Copy, Check, Ticket, Star, UserPlus, Users } from "lucide-react";

type Target = { id: string; name: string; phone: string | null };
type Campaign = { key: string; title: string; icon: typeof Cake; accent: string; description: string; template: string; targets: Target[] };

export function MarketingCampaigns({
  birthdays, lapsed, vips, attended, salonName,
}: {
  birthdays: Target[];
  lapsed: Target[];
  vips: Target[];
  attended: Target[];
  salonName: string;
}) {
  const campaigns: Campaign[] = [
    { key: "birthday", title: "Aniversariantes do mês", icon: Cake, accent: "#EC4899", description: "Parabenize e ofereça um mimo para trazer o cliente de volta no mês do aniversário.", template: `Feliz aniversário, {nome}! 🎉 Para comemorar, você ganhou {cupom} de desconto neste mês no ${salonName}. Bora agendar? 💈`, targets: birthdays },
    { key: "lapsed", title: "Resgate de sumidos", icon: Clock, accent: "#EF4444", description: "Reative quem não volta há mais de 60 dias com uma oferta de retorno.", template: `Oi {nome}, sentimos sua falta no ${salonName}! Volte com {cupom} de desconto no seu próximo horário. 💈`, targets: lapsed },
    { key: "vip", title: "Novidades para VIPs", icon: Crown, accent: "#F4C430", description: "Ofereça exclusividade aos seus melhores clientes.", template: `{nome}, você é cliente VIP do ${salonName}! Temos novidades e horários exclusivos esperando por você. ✨`, targets: vips },
    { key: "referral", title: "Programa de indicação", icon: UserPlus, accent: "#3B9EFF", description: "Convide clientes fiéis a compartilhar o link do seu estabelecimento.", template: `{nome}, gostou do atendimento no ${salonName}? Indique alguém especial! É só encaminhar nosso link de agendamento. 🤝`, targets: vips },
    { key: "review", title: "Pedir avaliação", icon: Star, accent: "#A855F7", description: "Peça feedback manual depois de atendimentos concluídos.", template: `Oi {nome}! Como foi sua experiência no ${salonName}? Responda esta mensagem com uma nota de 1 a 5 e conte o que podemos melhorar. Sua opinião ajuda muito! ⭐`, targets: attended },
  ];

  const [active, setActive] = useState(campaigns[0].key);
  const [templates, setTemplates] = useState<Record<string, string>>(Object.fromEntries(campaigns.map((c) => [c.key, c.template])));
  const [coupon, setCoupon] = useState("20% OFF");
  const [copied, setCopied] = useState<string | null>(null);

  const current = campaigns.find((c) => c.key === active)!;
  const template = templates[active];

  function render(name: string) {
    return template.replace(/\{nome\}/g, name.split(" ")[0]).replace(/\{cupom\}/g, coupon);
  }
  function waLink(t: Target) {
    const digits = (t.phone ?? "").replace(/\D/g, "");
    const full = digits.length <= 11 ? `55${digits}` : digits;
    return `https://wa.me/${full}?text=${encodeURIComponent(render(t.name))}`;
  }
  async function copyMsg(t: Target) {
    await navigator.clipboard.writeText(render(t.name));
    setCopied(t.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Seleção de campanha */}
      <div className="lg:col-span-1">
        <div className="lg:hidden">
          <label htmlFor="mobile-campaign" className="mb-2 block text-[12px] font-semibold">
            Escolha a campanha
          </label>
          <select
            id="mobile-campaign"
            aria-label="Escolher campanha"
            value={active}
            onChange={(event) => setActive(event.target.value)}
            className="h-12 w-full rounded-xl border border-border bg-card px-3 text-[14px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {campaigns.map((campaign) => (
              <option key={campaign.key} value={campaign.key}>
                {campaign.title} ({campaign.targets.length})
              </option>
            ))}
          </select>
          <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
            <p className="text-[12px] font-semibold">{current.title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{current.description}</p>
          </div>
        </div>

        <div className="hidden space-y-2 lg:block">
          {campaigns.map((c) => (
            <button
              key={c.key}
              onClick={() => setActive(c.key)}
              className={`w-full rounded-2xl border p-4 text-left transition ${active === c.key ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:bg-card-hover"}`}
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${c.accent}1f`, color: c.accent }}>
                  <c.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{c.title}</p>
                  <p className="text-[11px] text-muted-foreground">{c.targets.length} clientes</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{c.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Editor + alvos */}
      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">Mensagem</h3>
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1">
              <Ticket className="h-3.5 w-3.5 text-primary" />
              <input value={coupon} onChange={(e) => setCoupon(e.target.value)} className="w-20 bg-transparent text-[12px] focus:outline-none" placeholder="Cupom" />
            </div>
          </div>
          <textarea
            value={template}
            onChange={(e) => setTemplates((prev) => ({ ...prev, [active]: e.target.value }))}
            rows={3}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] focus:outline-none"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Use <code className="rounded bg-surface-1 px-1">{"{nome}"}</code> e <code className="rounded bg-surface-1 px-1">{"{cupom}"}</code> — trocamos automaticamente para cada cliente.
          </p>
          <a
            href="#marketing-destinatarios"
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[13px] font-semibold text-primary-foreground lg:hidden"
          >
            <Users className="h-4 w-4" />
            Ver destinatários ({current.targets.length})
          </a>
        </div>

        <div id="marketing-destinatarios" className="scroll-mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3 text-[13px] font-semibold">
            {current.targets.length} destinatários
          </div>
          {current.targets.length === 0 ? (
            <p className="p-8 text-center text-[13px] text-muted-foreground">Nenhum cliente neste segmento agora.</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {current.targets.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:flex-nowrap sm:px-5 sm:py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-1 text-[11px] font-semibold">
                    {t.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{t.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{t.phone ?? "sem telefone"}</p>
                  </div>
                  <div className="flex basis-full gap-2 pl-11 sm:basis-auto sm:pl-0">
                    <button onClick={() => copyMsg(t)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-muted-foreground transition hover:text-foreground" title="Copiar mensagem">
                      {copied === t.id ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                      <span className="sm:hidden">{copied === t.id ? "Copiado" : "Copiar"}</span>
                    </button>
                    {t.phone ? (
                      <a href={waLink(t)} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#25D366]/15 px-3 text-[12px] font-medium text-[#25D366] transition hover:bg-[#25D366]/25 sm:flex-none">
                        <MessageCircle className="h-3.5 w-3.5" />
                        <span className="sm:hidden">Enviar pelo WhatsApp</span>
                        <span className="hidden sm:inline">Enviar</span>
                      </a>
                    ) : (
                      <span className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-surface-1 px-3 text-[11px] text-muted-foreground sm:flex-none">Sem WhatsApp</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Por segurança, cada envio abre o WhatsApp com a mensagem pronta para você revisar e enviar — nada é disparado automaticamente.
        </p>
      </div>
    </div>
  );
}
