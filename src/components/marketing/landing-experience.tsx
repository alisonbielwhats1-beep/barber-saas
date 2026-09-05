"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowUpRight, Menu, X, CalendarDays, Users, Wallet, Package, Bell, Globe, Plus, Images, Layers } from "lucide-react";

import { useMarketingSegment } from "./use-segment";
import { MarketingBrand } from "./brand";
import { marketingFont } from "./font";
import { SceneHero } from "./scene-hero";
import { ProductScene } from "./product-scene";
import { ScrollNarrative } from "./scroll-narrative";
import { signupHref } from "./segments";
import { CapabilityShowcase } from "./capability-showcase";
import { PricingComparison } from "./pricing-comparison";
import "./marketing.css";
import "./refinement.css";

const chapters = [
  { title: "O dia inteiro, à vista.", text: "Veja horários, serviços e status de cada atendimento. Alterne entre dia, semana, mês e lista para encontrar o ritmo da sua operação.", label: "Agenda", icon: CalendarDays },
  { title: "Cada profissional no seu tempo.", text: "Filtre a agenda por profissional e encontre quem atende cada cliente. A equipe trabalha com acessos definidos por função.", label: "Equipe", icon: Users },
  { title: "Clareza para o próximo passo.", text: "Acompanhe atendimentos e diferencie receita prevista de realizada. Leve essa visão para o financeiro, as despesas e as comissões.", label: "Gestão", icon: Wallet },
];
const resources = [
  { icon: Layers, title: "Pacotes de serviços", text: "Organize sessões e acompanhe o uso dos pacotes contratados. Disponível a partir do plano Fundador." },
  { icon: Images, title: "Seu portfólio online", text: "Apresente seus trabalhos na página do estabelecimento e ajude o cliente a conhecer o seu estilo." },
  { icon: Users, title: "Clientes e histórico", text: "Conheça os atendimentos anteriores e mantenha as informações de cada cliente organizadas." },
  { icon: Package, title: "Serviços, produtos e estoque", text: "Organize seu catálogo, acompanhe movimentações e reúna serviços e produtos na comanda." },
  { icon: Bell, title: "Notificações internas", text: "Acompanhe confirmações, lembretes e mudanças de horário dentro do sistema." },
  { icon: Globe, title: "Seu agendamento online", text: "Compartilhe a página do estabelecimento. O cliente escolhe serviços, profissional e horário disponível." },
];
const questions = [
  ["O sistema funciona para o meu tipo de negócio?", "O SalonSaaS atende barbearias, salões, manicures, estética, massagem e espaços com vários serviços. Você configura o catálogo, a equipe e os horários conforme sua operação."],
  ["Meus clientes podem agendar pelo celular?", "Sim. Cada estabelecimento tem uma página pública. O cliente cria uma conta ou entra, escolhe serviços, profissional e um horário disponível, e revisa a reserva antes de confirmar."],
  ["Como funcionam os lembretes e o WhatsApp?", "O sistema oferece notificações internas e lembretes no aplicativo. O contato pelo WhatsApp é iniciado manualmente pela equipe. Não há disparos automáticos de WhatsApp incluídos."],
  ["Posso controlar o financeiro?", "Sim. Você acompanha receitas, despesas, comissões e relatórios, além de registrar pagamentos na operação. O sistema ainda não processa pagamentos online."],
  ["O que acontece depois do cadastro?", "Você cria sua conta e entra imediatamente no plano Grátis. Os serviços sugeridos ajudam a começar; depois, você configura os profissionais e os horários do seu estabelecimento."],
];

export function LandingExperience() {
  const { segment, selectSegment, ready } = useMarketingSegment();
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const dark = segment.id === "barbearia";

  function closeMenu(returnFocus = false) {
    setMenuOpen(false);
    if (returnFocus) menuButton.current?.focus();
  }

  return (
    <main ref={root} id="main-content" tabIndex={-1} className={`mk ${marketingFont.variable}`} data-ready={ready} data-atmosphere={dark ? "dark" : "light"} data-segment={segment.id}>
      <header className="mk-header" onKeyDown={(event) => { if (event.key === "Escape") closeMenu(true); }}>
        <div className="mk-header-inner">
          <MarketingBrand />
          <nav aria-label="Navegação principal" className="mk-desktop-nav"><a href="#sistema">O sistema</a><a href="#recursos">Recursos</a><a href="#planos">Planos</a></nav>
          <div className="mk-header-actions">
            <Link className="mk-login-link" href="/login">Entrar <ArrowUpRight size={15} aria-hidden="true" /></Link>
            <Link className="mk-button mk-button-small" href={signupHref(segment.id)}>Criar meu espaço <ArrowUpRight size={16} aria-hidden="true" /></Link>
            <button ref={menuButton} className="mk-menu-toggle" disabled={!ready} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="marketing-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
          </div>
        </div>
        <nav id="marketing-menu" aria-label="Navegação móvel" className="mk-mobile-nav" hidden={!menuOpen} onClick={() => closeMenu()}><a href="#sistema">O sistema</a><a href="#recursos">Recursos</a><a href="#planos">Planos</a><Link href="/login">Entrar na minha conta</Link></nav>
      </header>

      <SceneHero segment={segment} ready={ready} onSelect={selectSegment} />
      <ProductScene>
        <div className="sc-product-story">{chapters.map(item => <article key={item.title}><span><item.icon size={22} strokeWidth={1.5} aria-hidden="true" /></span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
      </ProductScene>
      <ScrollNarrative />
      <CapabilityShowcase />

      <section id="operacao" className="mk-resources mk-wrap">
        <div className="mk-resource-heading"><h2>O cuidado vai além<br /><span>da agenda.</span></h2><p>Uma base para administrar {segment.name}, sem perder os detalhes que tornam cada atendimento único.</p><a href="#planos" className="mk-text-link">Encontrar meu plano <ArrowUpRight size={18} aria-hidden="true" /></a></div>
        <div className="mk-resource-list">{resources.map((item) => <article key={item.title}><item.icon size={22} strokeWidth={1.5} aria-hidden="true" /><div><h3>{item.title}</h3><p>{item.text}</p></div></article>)}</div>
      </section>

      <section className="mk-start-section"><div className="mk-wrap mk-start-layout"><div><p className="mk-eyebrow">SEU PRÓXIMO CAPÍTULO</p><h2>Seu espaço.<br />Agora, conectado.</h2><p>Comece no plano Grátis, com acesso imediato. Prepare sua operação e compartilhe seu link de agendamento.</p></div><ol className="mk-steps"><li><span>1</span><div><h3>Apresente seu negócio</h3><p>Escolha seu segmento e comece no plano Grátis.</p></div></li><li><span>2</span><div><h3>Organize a casa</h3><p>Configure profissionais, serviços e horários de atendimento.</p></div></li><li><span>3</span><div><h3>Abra sua agenda online</h3><p>Compartilhe sua página e acompanhe as reservas pelo sistema.</p></div></li></ol></div></section>

      <PricingComparison segmentId={segment.id} />
      <section className="mk-faq mk-wrap"><h2>Antes de começar.</h2><div>{questions.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={19} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>
      <section className="mk-close"><div className="mk-wrap"><p>Seu próximo atendimento começa com uma boa organização.</p><h2>Cuide do seu talento.<br /><span>A gente organiza o resto.</span></h2><Link href={signupHref(segment.id)} className="mk-button">Criar meu espaço <ArrowUpRight size={20} aria-hidden="true" /></Link></div></section>
      <footer className="mk-footer mk-wrap"><div><MarketingBrand /><p>Gestão para beleza e bem-estar.</p></div><nav aria-label="Links institucionais"><Link href="/contato">Contato</Link><Link href="/termos">Termos de uso</Link><Link href="/privacidade">Privacidade</Link><Link href="/login">Entrar</Link></nav><span>© {new Date().getFullYear()} SalonSaaS</span></footer>
    </main>
  );
}
