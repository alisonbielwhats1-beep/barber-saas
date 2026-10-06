"use client";

import { useEffect, useState } from "react";
import { BellRing, Mail, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";

type State = "checking" | "ready" | "active" | "denied" | "install" | "unsupported" | "unavailable";

function isInstalled() {
  const apple = navigator as Navigator & { standalone?: boolean };
  return apple.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
}

function isAppleMobile() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function publicKeyBytes(key: string) {
  const padded = key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}

export function PushPermissionCard({ salonSlug, placement = "notifications" }: {
  salonSlug: string;
  placement?: "notifications" | "home";
}) {
  const [state, setState] = useState<State>("checking");
  const [publicKey, setPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function inspect() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (alive) setState(isAppleMobile() && !isInstalled() ? "install" : "unsupported");
        return;
      }
      if (isAppleMobile() && !isInstalled()) { if (alive) setState("install"); return; }
      const response = await fetch(`/api/client/push?salon=${encodeURIComponent(salonSlug)}`, { cache: "no-store" });
      if (!response.ok) { if (alive) setState("unavailable"); return; }
      const config = await response.json() as { enabled?: boolean; publicKey?: string };
      if (!config.enabled || !config.publicKey) { if (alive) setState("unavailable"); return; }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();
      let active = false;
      if (subscription) {
        const statusResponse = await fetch(`/api/client/push?salon=${encodeURIComponent(salonSlug)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription),
        });
        if (!statusResponse.ok) { if (alive) setState("unavailable"); return; }
        active = ((await statusResponse.json()) as { active?: boolean }).active === true;
      }
      if (alive) {
        setPublicKey(config.publicKey);
        setState(Notification.permission === "denied" ? "denied" : active ? "active" : "ready");
      }
    }
    inspect().catch(() => { if (alive) setState("unavailable"); });
    return () => { alive = false; };
  }, [salonSlug]);

  async function enable() {
    setBusy(true); setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "ready"); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKeyBytes(publicKey),
      });
      const response = await fetch(`/api/client/push?salon=${encodeURIComponent(salonSlug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      setState("active");
    } catch {
      setError("Não foi possível ativar neste aparelho. Tente novamente mais tarde.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch(`/api/client/push?salon=${encodeURIComponent(salonSlug)}`, {
          method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription),
        });
        if (!response.ok) throw new Error("DELETE_FAILED");
      }
      setState("ready");
    } catch { setError("Não foi possível desativar neste aparelho. Tente novamente."); }
    finally { setBusy(false); }
  }

  // Returning clients land on the home screen from their installed app. Show
  // the invitation there only while this device still needs to be linked.
  // The browser permission prompt remains behind the client's button tap.
  if (placement === "home") {
    if (state !== "ready") return null;
    return <section className="relative overflow-hidden rounded-2xl border border-[#8055cb]/35 bg-[#17141f] p-4 text-white shadow-[0_18px_45px_-30px_rgba(128,85,203,0.8)]" aria-label="Lembretes no celular">
      <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-[#8055cb]/20 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#8055cb]/25 text-[#d8bfff]"><BellRing className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#bda0ee]">Lembretes EverFlair</p>
          <h2 className="mt-1 text-base font-semibold">Receba avisos dos seus horários</h2>
          <p className="mt-1 text-sm leading-relaxed text-white/75">Ative neste aparelho para reservas futuras, inclusive as que você já marcou.</p>
        </div>
      </div>
      <div className="relative mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={enable} className="min-h-11 rounded-xl bg-[#a476ee] px-4 text-sm font-semibold text-[#180d28] hover:bg-[#b88fff] disabled:opacity-60">{busy ? "Ativando…" : "Ativar lembretes"}</button>
        <Link href={`/book/${salonSlug}/notificacoes`} className="inline-flex min-h-11 items-center text-sm font-medium text-white/75 underline underline-offset-4 hover:text-white">Como funciona</Link>
      </div>
      {error && <p role="alert" className="relative mt-3 text-sm text-rose-200">{error}</p>}
    </section>;
  }

  return <section className="relative overflow-hidden rounded-3xl border border-[#8055cb]/35 bg-[#17141f] p-5 text-white shadow-[0_18px_45px_-30px_rgba(128,85,203,0.8)]">
    <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-[#8055cb]/20 blur-3xl" />
    <div className="relative flex items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#8055cb]/25 text-[#d8bfff]"><BellRing className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#bda0ee]">Lembretes EverFlair</p>
        <h2 className="mt-1 text-lg font-semibold">Seu horário, sempre por perto</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">Receba um aviso na véspera e outro no dia da sua reserva. Ao tocar, você abre seus agendamentos.</p>
      </div>
    </div>
    <div className="relative mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/65">
      <span className="inline-flex items-center gap-1.5"><Smartphone className="h-4 w-4 text-[#c9aaff]" /> No celular com sua permissão</span>
      <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-[#c9aaff]" /> Você pode desativar quando quiser</span>
      <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4 text-[#c9aaff]" /> E-mail, se disponível</span>
    </div>
    <div className="relative mt-5" aria-live="polite">
      {state === "active" ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium text-[#d7f5df]">Notificações ativadas neste aparelho</p><button type="button" disabled={busy} onClick={disable} className="min-h-11 rounded-xl border border-white/30 px-4 text-sm font-medium hover:bg-white/10 disabled:opacity-60">Desativar</button></div> : null}
      {state === "ready" ? <button type="button" disabled={busy} onClick={enable} className="min-h-11 rounded-xl bg-[#a476ee] px-5 text-sm font-semibold text-[#180d28] hover:bg-[#b88fff] disabled:opacity-60">{busy ? "Ativando…" : "Ativar lembretes no celular"}</button> : null}
      {state === "install" ? <p className="rounded-xl border border-white/15 bg-white/5 p-3 text-sm">No iPhone, toque em Compartilhar → Adicionar à Tela de Início. Abra o app instalado e volte aqui para ativar os avisos.</p> : null}
      {state === "denied" ? <p className="text-sm text-white/80">Os avisos estão bloqueados nas configurações deste aparelho. Libere a permissão para o EverFlair e abra esta página novamente.</p> : null}
      {state === "unsupported" ? <p className="text-sm text-white/80">Este navegador não oferece notificações push. Seus lembretes continuam disponíveis nesta página.</p> : null}
      {state === "unavailable" ? <p className="text-sm text-white/80">Os avisos no celular estão indisponíveis agora. Seus lembretes continuam disponíveis nesta página.</p> : null}
      {state === "checking" ? <p className="text-sm text-white/65">Verificando este aparelho…</p> : null}
      {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
    </div>
  </section>;
}
