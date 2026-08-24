"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Check,
  ExternalLink,
  Download,
  Share2,
  QrCode,
  Link2,
  Lightbulb,
  Building2,
  HandCoins,
  UserPlus,
  ChevronDown,
  Instagram,
  MapPin,
  Megaphone,
  MessageCircle,
  Printer,
  Sprout,
} from "lucide-react";
import { buildManualPixMessage, buildReferralMessage } from "@/lib/growth-tools";

type Salon = { name: string; slug: string; plan: string; phone: string | null };

export function SharePage({ salon, bookingUrl }: { salon: Salon; bookingUrl: string }) {
  const [copied, setCopied] = useState(false);
  const [msgCopied, setMsgCopied] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);
  const [pixKey, setPixKey] = useState("");
  const [signalValue, setSignalValue] = useState("30,00");

  useEffect(() => {
    setPixKey(localStorage.getItem(`salonsaas:pix-key:${salon.slug}`) ?? "");
    setSignalValue(localStorage.getItem(`salonsaas:pix-value:${salon.slug}`) ?? "30,00");
  }, [salon.slug]);

  const qrDisplay = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(bookingUrl)}&bgcolor=ffffff&color=0b0b0b&qzone=2&format=png`;
  const qrDownload = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(bookingUrl)}&bgcolor=ffffff&color=0b0b0b&qzone=3&format=png`;

  const waMessage = `Olá! 👋 Agora você pode agendar comigo de forma fácil pelo celular.\n\nClique no link, escolha o serviço e o horário:\n👉 ${bookingUrl}\n\nRápido, simples e sem precisar ligar. 😊`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(waMessage)}`;
  const referralMessage = buildReferralMessage({ salonName: salon.name, bookingUrl });
  const signalCents = useMemo(() => {
    const value = Number(signalValue.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
  }, [signalValue]);
  const pixMessage = pixKey.trim() && signalCents > 0
    ? buildManualPixMessage({ salonName: salon.name, pixKey, amountCents: signalCents, bookingUrl })
    : "";

  async function copyLink() {
    await navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyMsg() {
    await navigator.clipboard.writeText(waMessage);
    setMsgCopied(true);
    setTimeout(() => setMsgCopied(false), 2000);
  }

  async function copyReferral() {
    await navigator.clipboard.writeText(referralMessage);
    setReferralCopied(true);
    setTimeout(() => setReferralCopied(false), 2000);
  }

  async function copyPix() {
    if (!pixMessage) return;
    localStorage.setItem(`salonsaas:pix-key:${salon.slug}`, pixKey.trim());
    localStorage.setItem(`salonsaas:pix-value:${salon.slug}`, signalValue);
    await navigator.clipboard.writeText(pixMessage);
    setPixCopied(true);
    setTimeout(() => setPixCopied(false), 2000);
  }

  async function downloadQr() {
    try {
      const res = await fetch(qrDownload);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qr-agendamento-${salon.slug}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(qrDownload, "_blank");
    }
  }

  const tips = [
    { icon: Printer, text: "Imprima o QR Code e coloque num porta-retrato na recepção" },
    { icon: Instagram, text: "Adicione o link na bio do Instagram e TikTok" },
    { icon: MessageCircle, text: "Envie a mensagem do WhatsApp para seus grupos de clientes" },
    { icon: MapPin, text: "Cadastre o link no Google Meu Negócio do salão" },
    { icon: Megaphone, text: "Cole numa plaquinha perto do espelho com 'Agende online'" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Crescimento
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Compartilhar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Leve clientes ao agendamento online do{" "}
          <span className="font-medium text-foreground">{salon.name}</span>.
        </p>
      </div>

      {/* Link + QR — grid 2 colunas */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* ── Link ─────────────────────────────────────────────────── */}
        <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10">
              <Link2 className="h-4 w-4 text-primary" />
            </span>
            <div>
              <p className="text-[13px] font-semibold">Link de agendamento</p>
              <p className="text-[11px] text-muted-foreground">Funciona no celular e no computador</p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 overflow-hidden rounded-xl border border-border bg-surface-1 px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {bookingUrl}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={copyLink}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copiado!" : "Copiar link"}
            </button>
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] text-muted-foreground transition hover:bg-card-hover hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ver página
            </a>
          </div>

          {/* Prévia da URL do cliente */}
          <div className="mt-auto pt-5">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">Prévia do link</p>
            <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
              <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-red-400/60" />
                <span className="h-2 w-2 rounded-full bg-yellow-400/60" />
                <span className="h-2 w-2 rounded-full bg-green-400/60" />
                <span className="ml-2 flex-1 truncate rounded bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                  {bookingUrl}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-3 text-[12px] text-muted-foreground">
                <Sprout aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
                Agendamento online · {salon.name}
              </div>
            </div>
          </div>
        </div>

        {/* ── QR Code ──────────────────────────────────────────────── */}
        <div className="flex flex-col items-center rounded-2xl border border-border bg-card p-5">
          <div className="flex w-full items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10">
              <QrCode className="h-4 w-4 text-primary" />
            </span>
            <div>
              <p className="text-[13px] font-semibold">QR Code</p>
              <p className="text-[11px] text-muted-foreground">Imprima e deixe na recepção</p>
            </div>
          </div>

          {/* Card premium do QR — fundo escuro, QR em caixa branca */}
          <div className="mt-5 w-full overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-[#1a1400] to-[#0f0f0f]">
            {/* Faixa âmbar superior */}
            <div className="flex items-center justify-center gap-2 border-b border-primary/10 py-3">
              <span className="h-px w-6 bg-primary/40" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/70">
                Agendamento online
              </span>
              <span className="h-px w-6 bg-primary/40" />
            </div>

            {/* QR em caixa branca — preto-no-branco para máxima legibilidade */}
            <div className="flex justify-center py-6">
              <div className="relative rounded-2xl bg-white p-4 shadow-[0_0_40px_rgba(245,158,11,0.15)]">
                {/* Cantos âmbar decorativos */}
                <span className="absolute -left-px -top-px h-5 w-5 rounded-tl-2xl border-l-2 border-t-2 border-primary" />
                <span className="absolute -right-px -top-px h-5 w-5 rounded-tr-2xl border-r-2 border-t-2 border-primary" />
                <span className="absolute -bottom-px -left-px h-5 w-5 rounded-bl-2xl border-b-2 border-l-2 border-primary" />
                <span className="absolute -bottom-px -right-px h-5 w-5 rounded-br-2xl border-b-2 border-r-2 border-primary" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDisplay}
                  alt={`QR Code — ${salon.name}`}
                  width={200}
                  height={200}
                  className="block"
                />
              </div>
            </div>

            {/* Nome do salão + instrução */}
            <div className="border-t border-primary/10 py-3 text-center">
              <p className="text-[13px] font-semibold text-white/90">{salon.name}</p>
              <p className="mt-0.5 text-[10px] text-white/40">
                Aponte a câmera do celular para agendar
              </p>
            </div>
          </div>

          <button
            onClick={downloadQr}
            className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-[13px] text-muted-foreground transition hover:bg-card-hover hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Baixar QR Code (600 × 600 px)
          </button>
        </div>
      </div>

      {/* ── WhatsApp ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#25D366]/15">
            <Share2 className="h-4 w-4 text-[#25D366]" />
          </span>
          <div>
            <p className="text-[13px] font-semibold">Mensagem para WhatsApp</p>
            <p className="text-[11px] text-muted-foreground">
              Pronta para enviar — adapte se quiser
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-1 px-4 py-3">
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
            {waMessage}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#1db954]"
          >
            <Share2 className="h-3.5 w-3.5" />
            Abrir WhatsApp
          </a>
          <button
            onClick={copyMsg}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] text-muted-foreground transition hover:bg-card-hover hover:text-foreground"
          >
            {msgCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {msgCopied ? "Copiado!" : "Copiar mensagem"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#3B9EFF]/15 text-[#3B9EFF]"><UserPlus className="h-4 w-4" /></span>
            <div>
              <p className="text-[13px] font-semibold">Mensagem de indicação</p>
              <p className="text-[11px] text-muted-foreground">Para clientes fiéis encaminharem a amigos</p>
            </div>
          </div>
          <p className="mt-4 whitespace-pre-line rounded-xl border border-border bg-surface-1 p-3 text-[13px] text-muted-foreground">{referralMessage}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(referralMessage)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-[13px] font-medium text-white">
              <Share2 className="h-3.5 w-3.5" /> Abrir WhatsApp
            </a>
            <button onClick={copyReferral} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-[13px] text-muted-foreground">
              {referralCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {referralCopied ? "Copiado!" : "Copiar"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><HandCoins className="h-4 w-4" /></span>
            <div>
              <p className="text-[13px] font-semibold">Sinal Pix manual</p>
              <p className="text-[11px] text-muted-foreground">Sem gateway e sem tarifa do SalonSaaS</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px]">
            <label className="text-[11px] text-muted-foreground">Chave Pix
              <input value={pixKey} onChange={(event) => setPixKey(event.target.value)} placeholder="CPF, telefone, e-mail ou chave" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground" />
            </label>
            <label className="text-[11px] text-muted-foreground">Valor do sinal
              <input value={signalValue} onChange={(event) => setSignalValue(event.target.value)} inputMode="decimal" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground" />
            </label>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">A chave fica salva somente neste navegador. A conferência do comprovante continua manual.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={!pixMessage} onClick={copyPix} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40">
              {pixCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {pixCopied ? "Salvo e copiado!" : "Salvar e copiar"}
            </button>
            {pixMessage && <a href={`https://wa.me/?text=${encodeURIComponent(pixMessage)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-[13px] text-muted-foreground"><Share2 className="h-3.5 w-3.5" /> Enviar</a>}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#3B9EFF]/15 text-[#3B9EFF]"><Building2 className="h-4 w-4" /></span>
          <div>
            <p className="text-[13px] font-semibold">Agendamento gratuito no Google</p>
            <p className="text-[11px] text-muted-foreground">Use o mesmo link público no Perfil da Empresa</p>
          </div>
        </div>
        <ol className="mt-4 grid gap-2 text-[12px] text-muted-foreground sm:grid-cols-3">
          <li className="rounded-xl bg-surface-1 p-3"><strong className="block text-foreground">1. Abra o perfil</strong>Acesse seu Perfil da Empresa no Google.</li>
          <li className="rounded-xl bg-surface-1 p-3"><strong className="block text-foreground">2. Edite agendamentos</strong>Escolha a opção de link para reservar.</li>
          <li className="rounded-xl bg-surface-1 p-3"><strong className="block text-foreground">3. Cole o link</strong>Use o endereço do SalonSaaS exibido acima.</li>
        </ol>
        <a href="https://business.google.com/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-[13px] text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /> Abrir Perfil da Empresa</a>
      </div>

      {/* ── Dicas ────────────────────────────────────────────────────── */}
      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 p-5 [&::-webkit-details-marker]:hidden">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10">
            <Lightbulb aria-hidden="true" className="h-4 w-4 text-primary" />
          </span>
          <span className="text-[13px] font-semibold">Dicas de divulgação</span>
          <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            Ver dicas
            <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="border-t border-border px-5 pb-5 pt-4">
          <ul className="space-y-3">
            {tips.map(({ icon: TipIcon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-1 text-muted-foreground">
                  <TipIcon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="pt-1 text-[13px] leading-snug text-muted-foreground">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
