import Link from "next/link";
import {
  CalendarDays,
  BarChart3,
  Users,
  Bell,
  ArrowRight,
  ArrowUpRight,
  Quote,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "./marketing-header";
import { SegmentExplorer } from "./segment-explorer";
import { ProductMockup } from "./product-mockup";
import { ClientMockup } from "./client-mockup";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />

      {/* Hero */}
      <section className="relative overflow-hidden pb-20 pt-32 md:pt-40">
        <div className="container grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-10">
          <div className="animate-fade-in">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              <ShieldCheck className="h-3 w-3" />
              Um sistema, vários tipos de negócio de beleza e bem-estar
            </div>
            <h1 className="font-display text-4xl leading-[1.1] tracking-tight md:text-6xl">
              Seu espaço organizado,
              <br />
              <span className="text-primary">sua agenda sempre em movimento.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Agenda online, cadastro de clientes, controle da equipe e visão
              financeira num só painel — para barbearias, salões, manicures,
              estética e espaços mistos.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-14 rounded-full px-8 text-base">
                <Link href="/signup">
                  Criar conta grátis <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-14 rounded-full border-white/20 bg-white/5 px-8 text-base backdrop-blur hover:bg-white/10"
              >
                <Link href="/book/north-barber">Ver demonstração</Link>
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Sem cartão de crédito para começar.
            </p>
          </div>

          <div className="animate-slide-up">
            <ProductMockup />
          </div>
        </div>
      </section>

      {/* Benefícios principais */}
      <section id="recursos" className="scroll-mt-24 border-t border-white/5 bg-muted/20 py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">
              O que mais pesa no dia a dia, resolvido primeiro
            </h2>
            <p className="mt-3 text-muted-foreground">
              Sem vinte recursos com o mesmo peso — o que realmente evita
              prejuízo e retrabalho.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                className="card-interactive rounded-2xl border border-white/10 bg-card p-6"
              >
                <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                  <b.icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 font-display text-lg">{b.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {b.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demonstração do sistema */}
      <section className="py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Como funciona na prática</h2>
            <p className="mt-3 text-muted-foreground">
              Um painel para quem gerencia, uma vitrine simples para quem agenda.
            </p>
          </div>

          <div className="mt-14 grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
                Para o dono
              </p>
              <ProductMockup />
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
                Para o cliente
              </p>
              <ClientMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Como funciona — passo a passo */}
      <section className="border-t border-white/5 bg-muted/20 py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Do zero ao primeiro agendamento</h2>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative rounded-2xl border border-white/10 bg-card p-5">
                <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <h3 className="mb-1.5 text-sm font-semibold">{s.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Qual é o seu tipo de negócio + recursos por segmento */}
      <section id="segmentos" className="scroll-mt-24 py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Qual é o seu tipo de negócio?</h2>
            <p className="mt-3 text-muted-foreground">
              A plataforma se adapta a textos, imagens e exemplos — mas nunca
              limita o que você pode cadastrar depois.
            </p>
          </div>
          <div className="mt-14">
            <SegmentExplorer />
          </div>
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="scroll-mt-24 border-t border-white/5 bg-muted/20 py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Planos</h2>
            <p className="mt-3 text-muted-foreground">
              Condições comerciais em definição — fale com a gente para os
              valores atuais.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`rounded-3xl border p-7 ${
                  p.highlight ? "border-primary/50 bg-primary/5" : "border-white/10 bg-card"
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
                      <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
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
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Prova de valor honesta */}
      <section className="py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <Quote className="mx-auto mb-6 h-8 w-8 text-primary" />
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
      <section className="relative overflow-hidden border-t border-white/5 py-32">
        <div className="container relative z-10 text-center">
          <h2 className="mx-auto max-w-2xl font-display text-4xl leading-tight md:text-5xl">
            Seu negócio <span className="text-primary">organizado e online</span>
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

      <MarketingFooter />
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
    // Não prometer envio automático: o cron de lembretes hoje só monta a
    // lista; quem dispara a mensagem é o dono, pelo painel. Ver
    // src/app/api/cron/reminders/route.ts.
    icon: Bell,
    title: "Lembrete antes de cada horário",
    description:
      "O painel separa os atendimentos do dia seguinte e você dispara o lembrete no WhatsApp em um toque.",
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
      "Faturamento, comissão por profissional e os serviços que mais dão retorno, em tempo real.",
  },
];

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

function MarketingFooter() {
  return (
    <footer className="border-t border-white/5 py-14 text-sm">
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

      <div className="container mt-10 border-t border-white/5 pt-6 text-xs text-muted-foreground">
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
