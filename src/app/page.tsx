import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CalendarDays,
  Scissors,
  BarChart3,
  Users,
  Sparkles,
  ArrowRight,
} from "lucide-react";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b border-border/60 backdrop-blur">
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

      {/* Hero */}
      <section className="container py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center animate-fade-in">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            Multi-tenant · pensado para escalar
          </div>
          <h1 className="font-display text-5xl leading-tight tracking-tight md:text-7xl">
            A agenda do seu salão,
            <br />
            <span className="text-primary">enfim organizada.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Agendamento online para clientes, controle total da agenda para você e
            um dashboard que mostra exatamente quanto cada profissional está gerando.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">
                Criar meu salão <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/book/luna-hair">Ver demo do cliente</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/60 bg-muted/30 py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl md:text-4xl">Tudo num só lugar</h2>
            <p className="mt-3 text-muted-foreground">
              Da primeira reserva ao fechamento do mês.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title} className="p-8 transition hover:shadow-md">
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 font-display text-xl">{f.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {f.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} SalonSaaS — feito para profissionais de beleza.
      </footer>
    </main>
  );
}

const features = [
  {
    icon: CalendarDays,
    title: "Agenda inteligente",
    description:
      "Cada profissional tem sua agenda, com regras de horário, pausas e bloqueios. Cliente reserva em 3 toques.",
  },
  {
    icon: BarChart3,
    title: "Dashboard financeiro",
    description:
      "Faturamento por dia, taxa de ocupação, comissão por profissional e os serviços que mais dão retorno.",
  },
  {
    icon: Users,
    title: "Base de clientes",
    description:
      "Histórico de cada cliente, aniversários, anotações e serviços preferidos. Fidelização sem planilha.",
  },
];
