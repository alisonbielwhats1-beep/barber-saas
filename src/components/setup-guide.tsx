import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { resolvePlanIntent } from "@/lib/marketing-plan";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SetupStep = { done: boolean; label: string; href: string };
const instructions = [
  "Escolha os dias e períodos de atendimento do estabelecimento.",
  "Confira o preço e a duração dos serviços que seus clientes podem agendar.",
  "Associe os serviços a quem atende e confira a jornada de cada profissional.",
  "Conheça o aplicativo do cliente e veja onde copiar o link para compartilhar.",
];

export function PlanInterestNotice({ intent, currentPlan }: { intent?: string; currentPlan: string | undefined }) {
  const plan = resolvePlanIntent(intent);
  if (currentPlan !== "FREE" || !plan || plan.plan === "FREE") return null;
  return <aside className="rounded-[14px] border border-border bg-card px-4 py-4 text-sm sm:px-5" aria-label="Plano de interesse"><strong className="font-semibold">Seu interesse: {plan.title} · {plan.price}/mês</strong><p className="mt-1.5 leading-relaxed text-muted-foreground">Seu plano ativo é o Grátis. Configure o espaço e confirme disponibilidade e upgrade com a plataforma. Nenhuma cobrança foi feita no cadastro.</p><Link className="mt-1 inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-4 lg:min-h-9" href="/contato">Conversar sobre o upgrade<ArrowRight size={15} aria-hidden="true" /></Link></aside>;
}

export function SetupGuide({ steps, resumeHref }: { steps: SetupStep[]; resumeHref?: string }) {
  const index = steps.findIndex(step => !step.done);
  if (index < 0) return null;
  const next = steps[index];
  const complete = steps.filter(step => step.done).length;
  return <section className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4 sm:p-5" aria-labelledby="setup-guide-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-[1_1_260px]">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Seu espaço, passo a passo · {complete} de {steps.length}</p>
        <h2 id="setup-guide-title" className="mt-2 text-base font-semibold leading-snug">{resumeHref ? "Continue de onde parou" : `Próximo passo: ${next.label.toLocaleLowerCase("pt-BR")}`}</h2>
        <p className="mt-1 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">{resumeHref ? "Retome a etapa salva ou escolha um dos passos abaixo. No final, conheça o aplicativo e seu link para os clientes." : instructions[index]}</p>
      </div>
      <Link href={resumeHref ?? next.href} className={cn(buttonVariants(), "max-sm:w-full")}>Continuar configuração<ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Configuração do espaço" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={complete}><div className="h-full rounded-full bg-accent" style={{ width: `${complete / steps.length * 100}%` }} /></div>
    <ol className="grid gap-2 sm:grid-cols-2">{steps.map((step, i) => <li key={step.label}><Link href={step.href} aria-current={i === index ? "step" : undefined} className={cn("flex min-h-11 items-center gap-2.5 rounded-[10px] border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-10", i === index ? "border-foreground/60" : "border-border-strong")}>{step.done ? <CheckCircle2 size={17} aria-hidden="true" className="shrink-0 text-success" /> : <Circle size={17} aria-hidden="true" className="shrink-0 text-muted-foreground" />}<span className="min-w-0">{step.label}<span className="sr-only">{step.done ? ", concluído" : ", pendente"}</span></span></Link></li>)}</ol>
  </section>;
}
