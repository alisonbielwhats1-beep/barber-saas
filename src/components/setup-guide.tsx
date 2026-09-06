import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { resolvePlanIntent } from "@/lib/marketing-plan";

export type SetupStep = { done: boolean; label: string; href: string };
const instructions = [
  "Cadastre o que você oferece e revise preço e duração de cada serviço.",
  "Adicione quem atende e associe os serviços realizados por cada profissional.",
  "Configure os dias e horários disponíveis no cadastro do profissional.",
  "Confira sua página e compartilhe o link para receber a primeira reserva.",
];

export function PlanInterestNotice({ intent, currentPlan }: { intent?: string; currentPlan: string | undefined }) {
  const plan = resolvePlanIntent(intent);
  if (currentPlan !== "FREE" || !plan || plan.plan === "FREE") return null;
  return <aside className="rounded-xl border border-border bg-card px-5 py-4 text-sm" aria-label="Plano de interesse"><strong>Seu interesse: {plan.title} · {plan.price}/mês</strong><p className="mt-2 text-muted-foreground">Seu plano ativo é o Grátis. Configure o espaço e confirme disponibilidade e upgrade com a plataforma. Nenhuma cobrança foi feita no cadastro.</p><Link className="mt-2 inline-flex min-h-11 items-center gap-2 underline underline-offset-4" href="/contato">Conversar sobre o upgrade<ArrowRight size={15} aria-hidden="true" /></Link></aside>;
}

export function SetupGuide({ steps }: { steps: SetupStep[] }) {
  const index = steps.findIndex(step => !step.done);
  if (index < 0) return null;
  const next = steps[index];
  const complete = steps.filter(step => step.done).length;
  return <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5" aria-labelledby="setup-guide-title">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs text-muted-foreground">SEU ESPAÇO, PASSO A PASSO · {complete} DE {steps.length}</p><h2 id="setup-guide-title" className="mt-2 text-lg font-semibold">Próximo passo: {next.label.toLocaleLowerCase("pt-BR")}</h2><p className="mt-2 max-w-xl text-sm text-muted-foreground">{instructions[index]}</p></div><Link href={next.href} className="inline-flex min-h-11 items-center gap-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Continuar configuração<ArrowRight size={16} aria-hidden="true" /></Link></div>
    <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Configuração do espaço" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={complete}><div className="h-full rounded-full bg-primary" style={{ width: `${complete / steps.length * 100}%` }} /></div>
    <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{steps.map((step, i) => <li key={step.label}><Link href={step.href} aria-current={i === index ? "step" : undefined} className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">{step.done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}<span>{step.label}<span className="sr-only">{step.done ? ", concluído" : ", pendente"}</span></span></Link></li>)}</ol>
  </section>;
}
