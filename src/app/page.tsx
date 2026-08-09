"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays,
  BarChart3,
  Users,
  Bell,
  ArrowRight,
  ArrowUpRight,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "./marketing-header";
import { MarketingExperienceHero } from "./marketing-experience-hero";
import { SegmentExplorer } from "./segment-explorer";
import { ProductMockup } from "./product-mockup";
import { ClientMockup } from "./client-mockup";
import { ProductWordmark } from "@/components/product-wordmark";
import { ScrollReveal } from "@/components/scroll-reveal";
import { getBusinessExperience } from "@/config/business-experience";
import { DEFAULT_SEGMENT_ID, getSegment, type SegmentId } from "@/lib/segments";

export default function LandingPage() {
  const [selectedId, setSelectedId] = useState<SegmentId>(DEFAULT_SEGMENT_ID);
  const experience = getBusinessExperience(selectedId);
  const segment = getSegment(selectedId);
  const benefits = BENEFITS.map((benefit, index) => ({
    ...benefit,
    description: BENEFIT_COPY[selectedId][index],
  }));

  return (
    <main
      data-marketing-experience="true"
      data-business-experience={selectedId}
      data-experience-direction={experience.visual.direction}
      data-experience-density={experience.visual.density}
      className="marketing-page experience-scope min-h-screen overflow-x-clip bg-background text-foreground"
    >
      <MarketingHeader />
      <MarketingExperienceHero selectedId={selectedId} onSelect={setSelectedId} />

      {/* Benefícios principais */}
      <section id="recursos" className="marketing-section marketing-section-muted scroll-mt-24 border-t border-border py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="marketing-section-eyebrow mb-4 text-xs font-semibold uppercase tracking-[0.2em]">
              Rotina sob controle
            </p>
            <h2 className="font-display text-3xl md:text-4xl">
              O que mais pesa no dia a dia, resolvido primeiro
            </h2>
            <p className="mt-3 text-muted-foreground">
              O essencial para proteger a rotina da sua {experience.terminology.establishment},
              sem excesso de telas ou retrabalho.
            </p>
          </div>

          <div className="marketing-benefit-grid mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {benefits.map((b, index) => (
              <ScrollReveal
                key={b.title}
                delay={index * 70}
                className="marketing-benefit-card card-interactive overflow-hidden rounded-[1.5rem] border border-border bg-card"
              >
                {index === 0 && (
                  <div className="marketing-benefit-photo relative min-h-44 overflow-hidden">
                    <Image
                      src={segment.accentImage}
                      alt={`Atendimento em ${segment.label.toLowerCase()}`}
                      fill
                      sizes="(max-width: 1023px) 100vw, 32vw"
                      className="object-cover transition duration-700 hover:scale-[1.025]"
                    />
                    <span className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                  </div>
                )}
                <div className="marketing-benefit-copy p-6">
                  <div className="marketing-detail-icon mb-4 grid h-11 w-11 place-items-center rounded-xl border border-border bg-foreground/[0.045] text-foreground">
                    <b.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 font-display text-lg">{b.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {b.description}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Demonstração do sistema */}
      <section className="marketing-section marketing-section-base py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="marketing-section-eyebrow mb-4 text-xs font-semibold uppercase tracking-[0.2em]">
              Produto em contexto
            </p>
            <h2 className="font-display text-3xl md:text-4xl">Como funciona na prática</h2>
            <p className="mt-3 text-muted-foreground">
              Uma operação preparada para {segment.label.toLowerCase()}, do painel à experiência de quem agenda.
            </p>
          </div>

          <div className="marketing-demo-grid mt-14 grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <p className="marketing-section-eyebrow mb-3 text-xs font-semibold uppercase tracking-widest">
                Para o dono
              </p>
              <ProductMockup segmentId={selectedId} />
            </div>
            <div>
              <p className="marketing-section-eyebrow mb-3 text-xs font-semibold uppercase tracking-widest">
                Para o cliente
              </p>
              <ClientMockup segmentId={selectedId} />
            </div>
          </div>
        </div>
      </section>

      {/* Como funciona — passo a passo */}
      <section className="marketing-section marketing-section-soft border-t border-border py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Do zero ao primeiro agendamento</h2>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <ScrollReveal key={s.title} delay={i * 60} className="marketing-step-card relative rounded-2xl border border-border bg-card p-5">
                <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-foreground/[0.045] text-sm font-semibold text-foreground">
                  {i + 1}
                </span>
                <h3 className="mb-1.5 text-sm font-semibold">{s.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{s.description}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Qual é o seu tipo de negócio + recursos por segmento */}
      <section id="segmentos" className="marketing-section marketing-section-base scroll-mt-24 py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Qual é o seu tipo de negócio?</h2>
            <p className="mt-3 text-muted-foreground">
              A plataforma se adapta a textos, imagens e exemplos — mas nunca
              limita o que você pode cadastrar depois.
            </p>
          </div>
          <div className="mt-14">
            <SegmentExplorer selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="marketing-section marketing-section-muted scroll-mt-24 border-t border-border py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Planos</h2>
            <p className="mt-3 text-muted-foreground">
              Condições comerciais em definição — fale com a gente para os
              valores atuais.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PLANS.map((p, index) => (
              <ScrollReveal
                key={p.name}
                delay={index * 70}
                data-highlighted={p.highlight || undefined}
                className={`marketing-plan-card rounded-3xl border border-border bg-card p-7 ${
                  p.highlight ? "marketing-plan-featured" : ""
                }`}
              >
                <h3 className="font-display text-xl">{p.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.audience}</p>
                <p className="mt-6 text-2xl font-semibold text-muted-foreground">
                  Consulte as condições
                </p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5">
                      <ArrowUpRight className="marketing-section-eyebrow mt-0.5 h-4 w-4 shrink-0" />
                      <span className="text-muted-foreground">{b}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={p.highlight ? "default" : "outline"}
                  className="mt-7 w-full rounded-full"
                >
                  <Link href="/signup">Começar</Link>
                </Button>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Prova de valor honesta */}
      <section className="marketing-section marketing-editorial-break py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <Quote className="marketing-section-eyebrow mx-auto mb-6 h-8 w-8" />
            <p className="font-display text-2xl leading-snug md:text-3xl">
              Desenvolvido junto com profissionais que vivem a rotina de
              atender, agendar e fechar o caixa todos os dias.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Ainda estamos construindo nossa base de estabelecimentos — sem
              números inventados por aqui.
            </p>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="marketing-section marketing-cta-section relative overflow-hidden border-t border-border py-32">
        <div className="container relative z-10 text-center">
          <h2 className="mx-auto max-w-2xl font-display text-4xl leading-tight md:text-5xl">
            Sua {experience.terminology.establishment}{" "}
            <span className="marketing-cta-accent">organizada e pronta para agendar</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Crie a conta, cadastre os serviços e compartilhe o link de
            agendamento. Sem cartão de crédito.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-14 rounded-full px-10 text-base">
              <Link href="/signup">
                Criar conta grátis <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-14 rounded-full px-10 text-base"
            >
              <Link href="/book/north-barber">Ver demonstração</Link>
            </Button>
          </div>
        </div>
      </section>

      <MarketingFooter experienceLabel={experience.label} />
    </main>
  );
}

const BENEFITS = [
  {
    icon: CalendarDays,
    title: "Agenda sem conflito",
    description:
      "Cada profissional com sua jornada, pausas e bloqueios. O cliente só vê horário que existe de verdade.",
  },
  {
    icon: Bell,
    title: "Lembrete antes de cada horário",
    description:
      "A notificação interna é automática, e o painel mantém o atalho manual de WhatsApp sem contratar serviço pago.",
  },
  {
    icon: Users,
    title: "Histórico de cada cliente",
    description:
      "Cadastro, preferências e retorno — sem depender de planilha ou caderno.",
  },
  {
    icon: BarChart3,
    title: "Visão financeira do dia",
    description:
      "Faturamento, comissão por profissional e os serviços que mais dão retorno, sempre atualizados.",
  },
];

const BENEFIT_COPY: Record<SegmentId, readonly [string, string, string, string]> = {
  barbearia: [
    "Jornadas, pausas e bloqueios por barbeiro. O cliente só vê um horário que existe de verdade.",
    "A equipe acompanha cada corte ou barba e mantém o contato com o cliente no momento certo.",
    "Preferências, frequência e último serviço ajudam a transformar uma visita em retorno.",
    "Acompanhe faturamento, comissão e desempenho dos serviços sem perder o ritmo do dia.",
  ],
  "salao-beleza": [
    "Organize coloração, corte e tratamentos longos respeitando a duração e a agenda de cada profissional.",
    "Clientes e equipe recebem o contexto necessário antes de serviços que exigem mais preparação.",
    "Fórmulas, preferências e recorrência ficam fáceis de consultar em cada novo atendimento.",
    "Compare faturamento, ocupação e serviços de maior retorno com uma leitura clara da operação.",
  ],
  "manicure-nail": [
    "Encaixe procedimentos e manutenções pela duração correta, sem sobrepor o horário da profissional.",
    "Lembretes facilitam a recorrência de gel, alongamento, nail art e cuidados periódicos.",
    "Preferências e intervalo entre manutenções ajudam a oferecer uma experiência mais pessoal.",
    "Visualize ticket, recorrência e procedimentos mais procurados sem transformar a rotina em planilha.",
  ],
  "estetica-bemestar": [
    "Sessões, intervalos e bloqueios ficam claros para preservar o ritmo de cada especialista.",
    "A comunicação acompanha tratamentos e pacotes com discrição, clareza e previsibilidade.",
    "Frequência e histórico de procedimentos permanecem organizados para um cuidado contínuo.",
    "Acompanhe sessões, ocupação e resultados da operação com uma visão calma e objetiva.",
  ],
  "espaco-misto": [
    "Profissionais e especialidades diferentes convivem na mesma agenda sem disputar o mesmo horário.",
    "Cada área recebe o contexto certo sem duplicar cadastros ou fragmentar a comunicação.",
    "Um único histórico reúne os atendimentos do cliente em cabelo, unhas, estética e outras áreas.",
    "Consolide faturamento, comissões e desempenho de várias categorias em uma visão coerente.",
  ],
};

const STEPS = [
  { title: "Cadastre seu estabelecimento", description: "Nome, contato e endereço para começar." },
  { title: "Adicione serviços e profissionais", description: "Cada um com sua agenda e especialidade." },
  { title: "Compartilhe sua página", description: "Link próprio para o cliente agendar sozinho." },
  { title: "Receba os atendimentos", description: "Confirme, remarque ou cancele em poucos toques." },
  { title: "Acompanhe os resultados", description: "Financeiro e relatórios direto do painel." },
];

const PLANS = [
  {
    name: "Essencial",
    audience: "Para quem está começando a organizar a agenda.",
    bullets: ["Agenda e agendamento online", "Cadastro de clientes", "Página pública do estabelecimento"],
    highlight: false,
  },
  {
    name: "Profissional",
    audience: "Para equipes que já têm rotina de atendimento.",
    bullets: ["Tudo do Essencial", "Financeiro e relatórios", "Pacotes e planos de assinatura"],
    highlight: true,
  },
  {
    name: "Premium",
    audience: "Para operações maiores, com mais de uma unidade.",
    bullets: ["Tudo do Profissional", "Recursos avançados de marketing", "Suporte prioritário"],
    highlight: false,
  },
];

function MarketingFooter({ experienceLabel }: { experienceLabel: string }) {
  return (
    <footer className="marketing-footer border-t border-border py-14 text-sm">
      <div className="container grid gap-10 md:grid-cols-5">
        <div className="md:col-span-2">
          <ProductWordmark />
          <p className="mt-2 max-w-xs text-muted-foreground">
            Gestão e agendamento para negócios de beleza e bem-estar.
          </p>
          <p className="marketing-section-eyebrow mt-4 text-[10px] font-semibold uppercase tracking-[0.16em]">
            Experiência para {experienceLabel}
          </p>
        </div>

        <FooterColumn
          title="Produto"
          items={[
            { label: "Recursos", href: "#recursos" },
            { label: "Para quem é", href: "#segmentos" },
            { label: "Planos", href: "#planos" },
          ]}
        />
        <FooterColumn
          title="Conta"
          items={[
            { label: "Entrar", href: "/login" },
            { label: "Criar conta", href: "/signup" },
          ]}
        />
        <FooterColumn
          title="Institucional"
          items={[
            { label: "Termos de uso", href: "/termos" },
            { label: "Política de privacidade", href: "/privacidade" },
            { label: "Contato", href: "/contato" },
          ]}
        />
      </div>

      <div className="container mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} SalonSaaS — feito para profissionais de beleza e bem-estar.
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  items,
}: {
  title: string;
  items: { label: string; href?: string; soon?: boolean }[];
}) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.label}>
            {it.soon || !it.href ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground/50">
                {it.label}
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
                  Em breve
                </span>
              </span>
            ) : (
              <Link href={it.href} className="text-muted-foreground transition hover:text-foreground">
                {it.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
