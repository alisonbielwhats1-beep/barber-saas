"use client";

import { useState } from "react";
import {
  Copy,
  Check,
  ExternalLink,
  Download,
  Share2,
  QrCode,
  Link2,
  Lightbulb,
} from "lucide-react";

type Salon = { name: string; slug: string; plan: string; phone: string | null };

export function SharePage({ salon, bookingUrl }: { salon: Salon; bookingUrl: string }) {
  const [copied, setCopied] = useState(false);
  const [msgCopied, setMsgCopied] = useState(false);

  const qrDisplay = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(bookingUrl)}&bgcolor=ffffff&color=0b0b0b&qzone=2&format=png`;
  const qrDownload = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(bookingUrl)}&bgcolor=ffffff&color=0b0b0b&qzone=3&format=png`;

  const waMessage = `Olá! 👋 Agora você pode agendar comigo de forma fácil pelo celular.\n\nClique no link, escolha o serviço e o horário:\n👉 ${bookingUrl}\n\nRápido, simples e sem precisar ligar. 😊`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

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
    { icon: "🖨️", text: "Imprima o QR Code e coloque num porta-retrato na recepção" },
    { icon: "📸", text: "Adicione o link na bio do Instagram e TikTok" },
    { icon: "💬", text: "Envie a mensagem do WhatsApp para seus grupos de clientes" },
    { icon: "📍", text: "Cadastre o link no Google Meu Negócio do salão" },
    { icon: "🪧", text: "Cole numa plaquinha perto do espelho com 'Agende online'" },
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
              <div className="px-3 py-3 text-[12px] text-muted-foreground">
                🌿 Agendamento online · {salon.name}
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

          {/* QR gerado via api.qrserver.com — sem dependência npm */}
          <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-white p-4 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDisplay}
              alt={`QR Code — ${salon.name}`}
              width={220}
              height={220}
              className="block"
            />
          </div>

          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Aponte a câmera do celular para agendar
          </p>

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

      {/* ── Dicas ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10">
            <Lightbulb className="h-4 w-4 text-primary" />
          </span>
          <p className="text-[13px] font-semibold">Dicas de divulgação</p>
        </div>
        <ul className="mt-4 space-y-3">
          {tips.map((t) => (
            <li key={t.text} className="flex items-start gap-3">
              <span className="text-base leading-none">{t.icon}</span>
              <span className="text-[13px] leading-snug text-muted-foreground">{t.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
