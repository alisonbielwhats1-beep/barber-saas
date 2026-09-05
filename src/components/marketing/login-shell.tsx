"use client";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { MarketingBrand } from "./brand";
import { useMarketingSegment } from "./use-segment";
import { marketingFont } from "./font";
import "./marketing.css";
import "./refinement.css";

export function PremiumLoginShell({ children }: { children: ReactNode }) {
  const { segment, ready } = useMarketingSegment();
  return <main id="main-content" tabIndex={-1} className={`mk mk-auth ${marketingFont.variable}`} data-ready={ready} data-segment={segment.id} data-atmosphere={segment.id === "barbearia" ? "dark" : "light"}>
    <section className="mk-auth-form-side"><MarketingBrand /><div className="mk-auth-form"><Link href="/" className="mk-auth-back"><ArrowLeft size={16} aria-hidden="true" />Voltar ao início</Link><p className="mk-eyebrow">BOM TER VOCÊ POR AQUI</p><h1>Seu espaço.<br /><span>Seu próximo dia.</span></h1><p className="mk-auth-description">Entre para acompanhar sua agenda, equipe e resultados.</p>{children}<p className="mk-auth-signup">Ainda não tem estabelecimento?<br /><Link href="/signup">Criar meu espaço <ArrowUpRight size={15} aria-hidden="true" /></Link></p></div><nav className="mk-auth-legal" aria-label="Informações legais"><Link href="/privacidade">Privacidade</Link><Link href="/termos">Termos de uso</Link><Link href="/contato">Precisa de ajuda?</Link></nav></section>
    <aside className="mk-auth-visual"><Image key={segment.id} src={segment.image} alt={segment.alt} fill priority quality={85} sizes="(max-width: 900px) 1px, (min-aspect-ratio: 2/1) 55vw, 100vw" style={{ objectPosition: segment.position }} /><div className="mk-auth-visual-copy"><p>O TALENTO É SEU.</p><h2>A tranquilidade de ter<br />tudo em ordem, também.</h2><span>SalonSaaS · {segment.label}</span></div></aside>
  </main>;
}
