"use client";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { MarketingBrand } from "./brand";
import { marketingFont } from "./font";
import { useMarketingSegment } from "./use-segment";
import type { MarketingSegmentId } from "./segments";
import "./marketing.css";
import "./establishment.css";
import "./refinement.css";

export function EstablishmentShell({ children, onboarding = false, initialSegment }: { children: ReactNode; onboarding?: boolean; initialSegment?: MarketingSegmentId }) {
  const { segment, ready } = useMarketingSegment(initialSegment);
  return <main id="main-content" tabIndex={-1} className={`mk es-page ${marketingFont.variable}`} data-ready={ready} data-entry={initialSegment ? "segment" : "direct"} data-segment={segment.id} data-atmosphere={segment.id === "barbearia" ? "dark" : "light"}>
    <header className="es-header"><MarketingBrand /><Link href={onboarding ? "/login" : "/"}><ArrowLeft size={15} aria-hidden="true" />{onboarding ? "Voltar ao login" : "Voltar ao início"}</Link></header>
    <div className="es-layout">
      <aside className="es-editorial"><div className="es-editorial-copy"><p className="mk-eyebrow">UM NOVO CAPÍTULO</p><h2>Seu talento.<br />Seu negócio.<br /><span>Seu espaço.</span></h2><p>Uma rotina bem cuidada começa aqui.</p><ul><li><Check size={15} aria-hidden="true" />Comece no plano Grátis</li><li><Check size={15} aria-hidden="true" />Serviços prontos para personalizar</li><li><Check size={15} aria-hidden="true" />Agenda e clientes em um só lugar</li></ul></div><div className="es-photo"><Image src={segment.image} alt={segment.alt} fill priority sizes="(max-width: 900px) 1px, 42vw" style={{ objectPosition: segment.position }} /><span>{segment.label} · SalonSaaS</span></div></aside>
      <section className="es-form-panel" aria-labelledby="establishment-title"><p className="es-kicker">{segment.label.toLocaleUpperCase("pt-BR")} · SEU NOVO ESPAÇO</p><h1 id="establishment-title">Vamos criar seu espaço.</h1><p className="es-description">{onboarding ? "Sua conta ainda não está ligada a um estabelecimento. Conte um pouco sobre seu negócio para começar." : "Conte um pouco sobre seu negócio e crie seu acesso. Você pode ajustar os detalhes depois."}</p>{children}{!onboarding && <p className="es-login">Já tem conta? <Link href="/login">Entrar</Link></p>}<nav className="es-legal" aria-label="Informações legais"><Link href="/termos">Termos de uso</Link><Link href="/privacidade">Privacidade</Link></nav></section>
    </div>
  </main>;
}
