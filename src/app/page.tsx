import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Scissors,
  BarChart3,
  Users,
  Sparkles,
  ArrowRight,
  ArrowUpRight,
  Star,
} from "lucide-react";

const img = (id: string, size = 1600) =>
  `https://images.unsplash.com/${id}?w=${size}&auto=format&fit=crop&q=80`;

// Curadoria dark moody — todas verificadas (HTTP 200)
const HERO = img("photo-1585747860715-2ba37e788b70", 2000); // barbeiro + cliente, cinematográfico
const OWNER_SIDE = img("photo-1512690459411-b9245aed614b", 1000); // interior barbearia dark
const CLIENT_SIDE = img("photo-1562322140-8baeececf3df", 1000); // styling feminino premium
const FEATURE_AGENDA = img("photo-1621607512214-68297480165e", 800); // navalha close-up
const FEATURE_BI = img("photo-1621605815971-fbc98d665033", 800); // fade masculino
const FEATURE_CRM = img("photo-1560066984-138dadb4c035", 800); // corte feminino
const CTA_BG = img("photo-1503951914875-452162b0f3f1", 2000); // barbershop clássico

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Nav flutuante */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-background/60 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-display text-xl">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Scissors className="h-4 w-4" />
            </span>
            Salon<span className="text-primary">SaaS</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Começar grátis</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero cinematográfico */}
      <section className="relative flex min-h-[92vh] items-center overflow-hidden">
        <Image
          src={HERO}
          alt="Barbeiro finalizando corte"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/20" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />

        <div className="container relative z-10 pt-16">
          <div className="max-w-2xl animate-fade-in">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              Multi-tenant · um sistema, vários salões
            </div>
            <h1 className="font-display text-5xl leading-[1.05] tracking-tight md:text-7xl">
              Sua barbearia,
              <br />
              <span className="text-primary">no controle total.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Agenda online que o cliente ama usar, dashboard que mostra cada
              real entrando e a operação inteira — equipe, serviços, produtos —
              num painel só.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-14 rounded-full px-8 text-base">
                <Link href="/signup">
                  Criar meu salão <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-14 rounded-full border-white/20 bg-white/5 px-8 text-base backdrop-blur hover:bg-white/10"
              >
                <Link href="/book/north-barber">Ver demo ao vivo</Link>
              </Button>
            </div>

            {/* Prova social */}
            <div className="mt-14 flex flex-wrap items-center gap-8 text-sm">
              <div>
                <p className="font-display text-3xl text-foreground">200+</p>
                <p className="text-muted-foreground">agendamentos/mês por salão</p>
              </div>
              <div className="h-10 w-px bg-white/10" />
              <div>
                <p className="font-display text-3xl text-foreground">3 toques</p>
                <p className="text-muted-foreground">do serviço à reserva</p>
              </div>
              <div className="h-10 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <Star className="h-5 w-5 fill-primary text-primary" />
                <p className="text-muted-foreground">
                  feito para barbearias <span className="text-foreground">e salões</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dois lados da plataforma */}
      <section className="container py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl md:text-5xl">Um app para cada lado do balcão</h2>
          <p className="mt-4 text-muted-foreground">
            O dono gerencia. O cliente agenda. Ninguém liga no WhatsApp perguntando horário.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {/* Card dono */}
          <Link
            href="/login"
            className="group relative overflow-hidden rounded-3xl border border-white/10"
          >
            <div className="relative aspect-[16/11] w-full overflow-hidden">
              <Image
                src={OWNER_SIDE}
                alt="Interior de barbearia premium"
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
            </div>
            <div className="absolute inset-x-0 bottom-0 p-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
                Para o dono
              </p>
              <h3 className="font-display text-2xl text-white md:text-3xl">
                Dashboard, agenda e financeiro
              </h3>
              <p className="mt-2 max-w-md text-sm text-white/70">
                Faturamento por dia, ocupação da equipe, comissões e os serviços
                que mais dão retorno — em tempo real.
              </p>
              <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
                Entrar no painel <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </Link>

          {/* Card cliente */}
          <Link
            href="/book/luna-hair"
            className="group relative overflow-hidden rounded-3xl border border-white/10"
          >
            <div className="relative aspect-[16/11] w-full overflow-hidden">
              <Image
                src={CLIENT_SIDE}
                alt="Styling em salão de alto padrão"
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
            </div>
            <div className="absolute inset-x-0 bottom-0 p-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
                Para o cliente
              </p>
              <h3 className="font-display text-2xl text-white md:text-3xl">
                Agendamento em 3 toques
              </h3>
              <p className="mt-2 max-w-md text-sm text-white/70">
                Vitrine de serviços com fotos, escolha de profissional, horários
                em tempo real e confirmação na hora.
              </p>
              <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black">
                Testar como cliente <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </Link>
        </div>
      </section>

      {/* Features com imagem */}
      <section className="border-t border-white/5 bg-muted/20 py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Tudo num só lugar</h2>
            <p className="mt-3 text-muted-foreground">
              Da primeira reserva ao fechamento do mês.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="group overflow-hidden rounded-3xl border border-white/10 bg-card transition hover:border-primary/40"
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <Image
                    src={f.image}
                    alt={f.title}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
                </div>
                <div className="p-7 pt-4">
                  <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 font-display text-xl">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {f.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="relative overflow-hidden py-32">
        <Image
          src={CTA_BG}
          alt="Barbearia clássica"
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-background/85" />
        <div className="container relative z-10 text-center">
          <h2 className="mx-auto max-w-2xl font-display text-4xl leading-tight md:text-5xl">
            Seu salão online em <span className="text-primary">30 segundos</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Crie a conta, cadastre os serviços e compartilhe o link de
            agendamento. Sem cartão de crédito.
          </p>
          <Button asChild size="lg" className="mt-10 h-14 rounded-full px-10 text-base">
            <Link href="/signup">
              Começar agora <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-white/5 py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} SalonSaaS — feito para profissionais de beleza.
      </footer>
    </main>
  );
}

const features = [
  {
    icon: CalendarDays,
    image: FEATURE_AGENDA,
    title: "Agenda inteligente",
    description:
      "Cada profissional tem sua agenda, com jornada, pausas e bloqueios. O cliente só vê horário que existe de verdade.",
  },
  {
    icon: BarChart3,
    image: FEATURE_BI,
    title: "Dashboard financeiro",
    description:
      "Faturamento por dia, taxa de ocupação, comissão por profissional e os serviços que mais dão retorno.",
  },
  {
    icon: Users,
    image: FEATURE_CRM,
    title: "Base de clientes",
    description:
      "Histórico de cada cliente, contato direto no WhatsApp e serviços preferidos. Fidelização sem planilha.",
  },
];
