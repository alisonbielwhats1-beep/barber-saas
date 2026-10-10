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
  type LucideIcon,
  MapPin,
  Megaphone,
  MessageCircle,
  Printer,
  Sprout,
} from "lucide-react";
import { buildManualPixMessage, buildReferralMessage } from "@/lib/growth-tools";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Salon = { name: string; slug: string; plan: string; phone: string | null };

/** A cópia pode falhar (permissão negada, iOS, página sem HTTPS): avisa em vez de falhar em silêncio. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast("Não foi possível copiar automaticamente. Selecione o texto na tela e copie manualmente.", "error");
    return false;
  }
}

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
    if (!(await copyToClipboard(bookingUrl))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyMsg() {
    if (!(await copyToClipboard(waMessage))) return;
    setMsgCopied(true);
    setTimeout(() => setMsgCopied(false), 2000);
  }

  async function copyReferral() {
    if (!(await copyToClipboard(referralMessage))) return;
    setReferralCopied(true);
    setTimeout(() => setReferralCopied(false), 2000);
  }

  async function copyPix() {
    if (!pixMessage) return;
    try {
      localStorage.setItem(`salonsaas:pix-key:${salon.slug}`, pixKey.trim());
      localStorage.setItem(`salonsaas:pix-value:${salon.slug}`, signalValue);
    } catch {
      // Armazenamento bloqueado (ex.: aba privada): a mensagem ainda pode ser copiada.
    }
    if (!(await copyToClipboard(pixMessage))) return;
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
    <div className="space-y-4 lg:space-y-6">
      <div>
        <PageHeader title="Presença online" />
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Leve clientes ao agendamento online do{" "}
          <span className="font-semibold text-foreground">{salon.name}</span>.
        </p>
      </div>

      {/* Celular: link, QR, WhatsApp, indicação e Pix. Computador: duas colunas (link, indicação e Pix | QR e WhatsApp). */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 lg:gap-4">

        {/* ── Link ─────────────────────────────────────────────────── */}
        <div className={cn(cardClass, "lg:col-start-1 lg:row-start-1")}>
          <CardHead icon={Link2} title="Link de agendamento" text="Funciona no celular e no computador" />

          <div className="overflow-hidden rounded-xl border border-border bg-background px-3.5 py-3">
            <p className="truncate text-sm tabular-nums text-muted-foreground" title={bookingUrl}>
              {bookingUrl}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={copyLink}>
              {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
              {copied ? "Copiado!" : "Copiar link"}
            </Button>
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
              Ver página
            </a>
          </div>

          {/* Prévia da URL do cliente */}
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Prévia do link</p>
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-border-strong" />
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-border-strong" />
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-border-strong" />
                <span className="ml-1.5 min-w-0 flex-1 truncate rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground" title={bookingUrl}>
                  {bookingUrl}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3.5 py-3 text-sm text-muted-foreground">
                <Sprout aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                Agendamento online · {salon.name}
              </div>
            </div>
          </div>
        </div>

        {/* ── QR Code ──────────────────────────────────────────────── */}
        <div className={cn(cardClass, "lg:col-start-2 lg:row-span-2 lg:row-start-1")}>
          <CardHead icon={QrCode} title="QR Code" text="Imprima e deixe na recepção" />

          {/* QR sempre preto no branco, para ler bem em qualquer tema */}
          <div className="flex w-full flex-col items-center overflow-hidden rounded-2xl border border-border-strong bg-background">
            <div className="flex w-full items-center justify-center gap-2.5 border-b border-border py-2.5">
              <span aria-hidden="true" className="h-px w-6 bg-border-strong" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Agendamento online
              </span>
              <span aria-hidden="true" className="h-px w-6 bg-border-strong" />
            </div>

            <div className="my-5 rounded-[14px] bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDisplay}
                alt={`QR Code — ${salon.name}`}
                width={200}
                height={200}
                className="block h-auto w-[200px] max-w-full"
              />
            </div>

            <div className="w-full border-t border-border px-3 py-2.5 text-center">
              <p className="text-sm font-semibold [overflow-wrap:anywhere]">{salon.name}</p>
              <p className="text-xs text-muted-foreground">
                Aponte a câmera do celular para agendar
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <Button type="button" variant="outline" onClick={downloadQr} className="h-auto whitespace-normal py-2 text-center">
              <Download aria-hidden="true" className="h-4 w-4" />
              Baixar QR Code (600 × 600 px)
            </Button>
          </div>
        </div>

        {/* ── WhatsApp ─────────────────────────────────────────────────── */}
        <div className={cn(cardClass, "lg:col-start-2 lg:row-start-3 lg:self-start")}>
          <CardHead icon={Share2} title="Mensagem para WhatsApp" text="Pronta para enviar — adapte se quiser" />

          <p className={messageClass}>
            {waMessage}
          </p>

          <div className="flex flex-wrap gap-2">
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants()}
            >
              <MessageCircle aria-hidden="true" className="h-4 w-4" />
              Abrir WhatsApp
            </a>
            <Button type="button" variant="outline" onClick={copyMsg}>
              {msgCopied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
              {msgCopied ? "Copiado!" : "Copiar mensagem"}
            </Button>
          </div>
        </div>

        <div className={cn(cardClass, "lg:col-start-1 lg:row-start-2")}>
          <CardHead icon={UserPlus} title="Mensagem de indicação" text="Para clientes fiéis encaminharem a amigos" />
          <p className={messageClass}>{referralMessage}</p>
          <div className="flex flex-wrap gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(referralMessage)}`} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
              <MessageCircle aria-hidden="true" className="h-4 w-4" /> Abrir WhatsApp
            </a>
            <Button type="button" variant="outline" onClick={copyReferral}>
              {referralCopied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />} {referralCopied ? "Copiado!" : "Copiar"}
            </Button>
          </div>
        </div>

        <div className={cn(cardClass, "lg:col-start-1 lg:row-start-3 lg:self-start")}>
          <CardHead icon={HandCoins} title="Sinal Pix manual" text="Sem gateway e sem tarifa do Everflair" />
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[minmax(0,1fr)_120px] sm:gap-4">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">Chave Pix</span>
              <Input value={pixKey} onChange={(event) => setPixKey(event.target.value)} placeholder="CPF, telefone, e-mail ou chave" autoComplete="off" autoCapitalize="none" />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">Valor do sinal</span>
              <Input value={signalValue} onChange={(event) => setSignalValue(event.target.value)} inputMode="decimal" className="tabular-nums" />
            </label>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">A chave fica salva somente neste navegador. A conferência do comprovante continua manual.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!pixMessage} onClick={copyPix}>
              {pixCopied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />} {pixCopied ? "Salvo e copiado!" : "Salvar e copiar"}
            </Button>
            {pixMessage && <a href={`https://wa.me/?text=${encodeURIComponent(pixMessage)}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}><Share2 aria-hidden="true" className="h-4 w-4" /> Enviar</a>}
          </div>
        </div>
      </div>

      <div className={cardClass}>
        <CardHead icon={Building2} title="Agendamento gratuito no Google" text="Use o mesmo link público no Perfil da Empresa" />
        <ol className="grid gap-2 sm:grid-cols-3">
          <li className={stepClass}><strong className="mb-0.5 block text-sm font-semibold text-foreground">1. Abra o perfil</strong>Acesse seu Perfil da Empresa no Google.</li>
          <li className={stepClass}><strong className="mb-0.5 block text-sm font-semibold text-foreground">2. Edite agendamentos</strong>Escolha a opção de link para reservar.</li>
          <li className={stepClass}><strong className="mb-0.5 block text-sm font-semibold text-foreground">3. Cole o link</strong>Use o endereço do Everflair exibido acima.</li>
        </ol>
        <a href="https://business.google.com/" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "self-start")}><ExternalLink aria-hidden="true" className="h-4 w-4" /> Abrir Perfil da Empresa</a>
      </div>

      {/* ── Dicas ────────────────────────────────────────────────────── */}
      <details className="group space-y-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-[14px] border border-border bg-card px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-10 [&::-webkit-details-marker]:hidden">
          <Lightbulb aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          <span>Dicas de divulgação</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            Ver dicas
            <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <ul className="space-y-3 rounded-[14px] border border-border bg-card p-4">
          {tips.map(({ icon: TipIcon, text }) => (
            <li key={text} className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-muted text-foreground">
                <TipIcon aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="pt-1.5 text-sm leading-snug text-muted-foreground">{text}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const cardClass = "flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4";
const messageClass = "whitespace-pre-line rounded-xl border border-border bg-background px-3.5 py-3 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]";
const stepClass = "rounded-xl border border-border bg-background px-3.5 py-3 text-sm leading-relaxed text-muted-foreground";

function CardHead({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
