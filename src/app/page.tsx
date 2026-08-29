import Link from "next/link";
import {
  CalendarDays,
  BarChart3,
  Users,
  Bell,
  ArrowRight,
  Check,
  Building2,
  ShieldCheck,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "./marketing-header";
import { SegmentExplorer } from "./segment-explorer";
import { AnimatedLandingHero, LandingReveal } from "./animated-landing";
import { LandingMobileShowcase } from "./landing-mobile-showcase";
import { PLAN_PRICING_ROWS } from "@/lib/plan-entitlements";

export default function LandingPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-theme="marketing-light"
      className="min-h-dvh overflow-hidden bg-background"
    >
      <MarketingHeader />
      <AnimatedLandingHero />

      {/* Segmentos — identificação imediata logo após o hero */}
      <section id="segmentos" className="landing-section scroll-mt-24 border-y border-border/70 bg-white/45">
        <LandingReveal className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="landing-eyebrow mb-3">
              Feito para a sua rotina
            </p>
            <h2 className="font-display text-3xl leading-tight tracking-[-0.035em] sm:text-4xl md:text-5xl">
              Qual é o seu tipo de negócio?
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted-foreground">
              Uma plataforma flexível para combinar serviços, profissionais e
              rotinas sem limitar o crescimento do seu espaço.
            </p>
          </div>
          <div className="mt-10 sm:mt-14">
            <SegmentExplorer />
          </div>
        </LandingReveal>
      </section>

      {/* Benefícios principais */}
      <section id="recursos" className="landing-section scroll-mt-24">
        <LandingReveal className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="landing-eyebrow mb-3">Menos retrabalho, mais controle</p>
            <h2 className="font-display text-3xl leading-tight tracking-[-0.03em] md:text-4xl">
              Tudo o que mais impacta sua operação, em um só lugar
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted-foreground">
              Organize a rotina, reduza falhas e acompanhe o que acontece no
              seu negócio sem depender de várias ferramentas.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                className="landing-card rounded-2xl p-6"
              >
                <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                  <b.icon aria-hidden="true" className="h-5 w-5" />
                </div>
                <h3 className="mb-2 font-display text-lg">{b.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {b.description}
                </p>
              </div>
            ))}
          </div>
        </LandingReveal>
      </section>

      <LandingMobileShowcase />

      {/* Como funciona — passo a passo */}
      <section className="landing-section border-y border-border/70 bg-white/45">
        <LandingReveal className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="landing-eyebrow mb-3">Comece sem complicar</p>
            <h2 className="font-display text-3xl leading-tight tracking-[-0.03em] md:text-4xl">
              Do cadastro ao primeiro agendamento
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted-foreground">
              Configure sua operação, publique sua página e centralize a rotina
              da equipe em poucos passos.
            </p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <div key={s.title} className="landing-card relative rounded-2xl p-5">
                <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <h3 className="mb-1.5 text-sm font-semibold">{s.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{s.description}</p>
              </div>
            ))}
          </div>
        </LandingReveal>
      </section>

      {/* Planos */}
      <section id="planos" className="landing-section scroll-mt-24">
        <LandingReveal className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="landing-eyebrow mb-3">Planos que acompanham seu negócio</p>
            <h2 className="font-display text-3xl leading-tight tracking-[-0.03em] md:text-4xl">
              Comece com o que sua operação precisa hoje
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted-foreground">
              Uma base completa para organizar o primeiro espaço e evoluir
              conforme sua equipe, seus serviços e suas unidades crescerem.
            </p>
          </div>

          <div className="mt-14 overflow-hidden rounded-[2rem] border border-border bg-card shadow-[0_32px_80px_-58px_rgba(23,32,28,0.5)]">
            <div className="grid lg:grid-cols-[0.82fr_1.18fr]">
              <div
                className="bg-[#17201c] p-7 text-white sm:p-10 lg:p-12"
                data-theme="marketing-dark"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Oferta de lançamento
                </p>
                <div className="mt-4 flex items-end gap-2">
                  <span className="font-display text-5xl leading-none tracking-[-0.05em] sm:text-6xl">
                    R$ 49,90
                  </span>
                  <span className="pb-1 text-sm text-muted-foreground">/mês</span>
                </div>
                <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Os 10 primeiros estabelecimentos podem começar com o plano
                  Fundador. Depois, evolua para o Pro sem taxa por cliente.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                  <Button asChild size="lg" className="h-12 rounded-full px-6">
                  <Link href="/signup">Começar grátis</Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="h-12 rounded-full px-6">
                    <Link href="/book/north-barber">Ver demonstração</Link>
                  </Button>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">Sem cartão · sem taxa por agendamento</p>
              </div>

              <div className="p-7 sm:p-10 lg:p-12">
                <h3 className="font-display text-2xl tracking-[-0.025em]">
                  Um plano claro para cada fase
                </h3>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Comece no Grátis e pague somente quando a operação pedir mais
                  agendas e recursos de crescimento.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {PLAN_PRICING_ROWS.map((row) => (
                    <article key={row.plan} className={`rounded-2xl border p-4 ${row.plan === "STARTER" ? "border-primary bg-primary/5" : "border-border bg-background/60"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold">{row.title}</h4>
                        {row.plan === "STARTER" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">10 primeiros</span>}
                      </div>
                      <p className="mt-3 text-xl font-semibold tracking-tight">{row.price}<span className="text-xs font-normal text-muted-foreground">{row.plan === "FREE" ? "" : "/mês"}</span></p>
                      <p className="mt-1 text-xs text-muted-foreground">{row.professionals} · {row.detail}</p>
                    </article>
                  ))}
                </div>
                <ul className="mt-8 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  {PLAN_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Check aria-hidden="true" className="h-3.5 w-3.5" />
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </LandingReveal>
      </section>

      {/* Prova de valor honesta */}
      <section className="landing-section border-t border-border/60 bg-white/35">
        <LandingReveal className="container">
          <div className="mx-auto max-w-3xl text-center">
            <Quote aria-hidden="true" className="mx-auto mb-6 h-8 w-8 text-primary" />
            <p className="font-display text-2xl leading-snug md:text-3xl">
              Desenvolvido ouvindo profissionais que vivem a rotina de
              atender, agendar e fechar o caixa todos os dias.
            </p>
            <div className="mt-10 grid gap-3 text-left sm:grid-cols-3">
              {TRUST_POINTS.map((point) => (
                <div key={point.title} className="rounded-2xl border border-border bg-card/80 p-4">
                  <point.icon aria-hidden="true" className="h-5 w-5 text-primary" />
                  <h3 className="mt-3 text-sm font-semibold">{point.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{point.description}</p>
                </div>
              ))}
            </div>
          </div>
        </LandingReveal>
      </section>

      {/* CTA final */}
      <section className="relative overflow-hidden border-t border-border bg-[#17201c] py-32 text-white" data-theme="marketing-dark">
        <LandingReveal className="container relative z-10 text-center">
          <h2 className="mx-auto max-w-2xl font-display text-4xl leading-tight md:text-5xl">
            Seu negócio <span className="text-primary">organizado e online</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Reúna agenda, clientes, equipe e resultados em uma plataforma que
            se adapta à rotina do seu espaço.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-14 rounded-full px-10 text-base">
              <Link href="/signup">
                Criar meu espaço <ArrowRight className="h-4 w-4" />
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
          <p className="mt-4 text-xs text-muted-foreground">Comece grátis · sem cartão</p>
        </LandingReveal>
      </section>

      <MarketingFooter />
    </main>
  );
}

const BENEFITS = [
  {
    icon: CalendarDays,
    title: "Agenda sem conflito",
    description:
      "Ofereça apenas horários realmente disponíveis e mantenha cada profissional com sua rotina organizada.",
  },
  {
    icon: Bell,
    title: "Lembretes que reduzem faltas",
    description:
      "Reduza esquecimentos com lembretes e mantenha o contato com o cliente a poucos toques.",
  },
  {
    icon: Users,
    title: "Histórico de cada cliente",
    description:
      "Cadastro, preferências e retorno — sem depender de planilha ou caderno.",
  },
  {
    icon: BarChart3,
    title: "Resultados mais claros",
    description:
      "Acompanhe faturamento, comissões e os serviços que mais movimentam o seu negócio.",
  },
];

const STEPS = [
  { title: "Cadastre seu estabelecimento", description: "Nome, contato e endereço para começar." },
  { title: "Adicione serviços e profissionais", description: "Cada um com sua agenda e especialidade." },
  { title: "Compartilhe sua página", description: "Link próprio para o cliente agendar sozinho." },
  { title: "Receba os atendimentos", description: "Confirme, remarque ou cancele em poucos toques." },
  { title: "Acompanhe os resultados", description: "Financeiro e relatórios direto do painel." },
];

const PLAN_FEATURES = [
  "Agenda e agendamento online",
  "Clientes, serviços e profissionais",
  "Página pública do estabelecimento",
  "Financeiro e relatórios operacionais",
  "Notificações e histórico de atendimento",
  "Produtos, pacotes e portfólio",
];

const TRUST_POINTS = [
  {
    icon: Users,
    title: "Feito para a rotina real",
    description: "Fluxos pensados para quem atende e administra todos os dias.",
  },
  {
    icon: ShieldCheck,
    title: "Operação confiável",
    description: "Agenda, permissões e histórico tratados com consistência.",
  },
  {
    icon: Building2,
    title: "Pronto para evoluir",
    description: "Uma base flexível para novos serviços, profissionais e unidades.",
  },
];

function MarketingFooter() {
  return (
    <footer className="border-t border-border py-14 text-sm">
      <div className="container grid gap-10 md:grid-cols-5">
        <div className="md:col-span-2">
          <p className="font-display text-lg">
            Salon<span className="text-primary">SaaS</span>
          </p>
          <p className="mt-2 max-w-xs text-muted-foreground">
            Gestão e agendamento para negócios de beleza e bem-estar.
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
            { label: "Criar meu espaço", href: "/signup" },
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
              <Link
                href={it.href}
                className="inline-flex min-h-11 items-center rounded-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {it.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
