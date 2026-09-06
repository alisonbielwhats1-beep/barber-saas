import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { PLAN_ENTITLEMENTS, PLAN_PRICING_ROWS } from "@/lib/plan-entitlements";
import { MARKETING_PLAN_KEYS } from "@/lib/marketing-plan";
import { signupHref, type MarketingSegmentId } from "./segments";
import "./pricing.css";

const included = ["Agenda e agendamento online", "Clientes, serviços e profissionais", "Página pública e aplicativo do cliente", "Financeiro e relatórios operacionais", "Notificações e histórico de atendimento"];
const optional = [{ label: "Produtos e estoque", key: "INVENTORY" as const }, { label: "Pacotes", key: "PACKAGES" as const }, { label: "Marketing e campanhas", key: "MARKETING" as const }];

export function PricingComparison({ segmentId }: { segmentId: MarketingSegmentId }) {
  return <section id="planos" className="pc-section mk-wrap" aria-labelledby="pricing-title">
    <div className="pc-heading"><div><p className="mk-eyebrow">CLAREZA PARA ESCOLHER</p><h2 id="pricing-title">Seu espaço. Seu ritmo.<br /><span>Um plano que acompanha.</span></h2><p>Comece grátis. Compare a capacidade e escolha o próximo passo quando fizer sentido para sua equipe.</p></div><aside className="pc-founder"><span>OFERTA DE LANÇAMENTO</span><strong>{PLAN_PRICING_ROWS[1].price}<small>/mês</small></strong><p>Fundador para os 10 primeiros estabelecimentos, sujeito à disponibilidade.</p></aside></div>
    <div className="pc-cards">{PLAN_PRICING_ROWS.map(plan => <article key={plan.plan} data-featured={plan.plan === "PRO"}><span className="pc-plan-kind">{plan.plan === "FREE" ? "PARA COMEÇAR" : plan.plan === "STARTER" ? "SUJEITO À DISPONIBILIDADE" : plan.plan === "PRO" ? "PARA SUA OPERAÇÃO" : "PARA MAIS TALENTOS"}</span><h3>{plan.title}</h3><p className="pc-price">{plan.price}<small>{plan.plan !== "FREE" && "/mês"}</small></p><p className="pc-capacity">{plan.professionals}</p><p className="pc-detail">{plan.detail}</p><Link href={signupHref(segmentId, MARKETING_PLAN_KEYS[plan.plan])} className={`mk-button ${plan.plan === "PRO" ? "" : "mk-button-outline"}`} aria-label={plan.plan === "FREE" ? "Começar no plano Grátis" : `Começar com interesse no ${plan.title}`}>{plan.plan === "FREE" ? "Começar grátis" : `Escolher ${plan.title}`}<ArrowUpRight size={16} aria-hidden="true" /></Link></article>)}</div>
    <p className="pc-next"><strong>Como funciona depois da escolha?</strong>A conta começa no Grátis, sem cobrança neste cadastro. Seu plano de interesse acompanha o primeiro acesso; o upgrade é confirmado com a plataforma. No Equipe, cada agenda adicional custa R$ 19,90/mês.</p>
    <details className="pc-details"><summary>Comparar todos os recursos<ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="pc-comparison" tabIndex={0} role="region" aria-label="Comparação dos planos"><table><caption>O que cada plano inclui</caption><thead><tr><th scope="col">Recurso</th>{PLAN_PRICING_ROWS.map(plan => <th key={plan.plan} scope="col">{plan.title}</th>)}</tr></thead><tbody>
        <tr><th scope="row">Agendas de profissionais</th>{PLAN_PRICING_ROWS.map(plan => <td key={plan.plan}>{PLAN_ENTITLEMENTS[plan.plan].maxProfessionals}</td>)}</tr>
        <tr><th scope="row">Agendamentos por mês</th>{PLAN_PRICING_ROWS.map(plan => <td key={plan.plan}>{PLAN_ENTITLEMENTS[plan.plan].monthlyAppointments ?? "Ilimitados"}</td>)}</tr>
        {included.map(label => <tr key={label}><th scope="row">{label}</th>{PLAN_PRICING_ROWS.map(plan => <td key={plan.plan}>Incluído</td>)}</tr>)}
        {optional.map(feature => <tr key={feature.key}><th scope="row">{feature.label}</th>{PLAN_PRICING_ROWS.map(plan => <td key={plan.plan}>{PLAN_ENTITLEMENTS[plan.plan].features[feature.key] ? "Incluído" : "Não incluído"}</td>)}</tr>)}
      </tbody></table></div>
      <div className="pc-mobile-comparison">{PLAN_PRICING_ROWS.map(plan => <details key={plan.plan}><summary>{plan.title} · {plan.professionals}</summary><ul><li>{PLAN_ENTITLEMENTS[plan.plan].monthlyAppointments ?? "Ilimitados"} agendamentos/mês</li>{included.map(label => <li key={label}>{label}</li>)}{optional.map(feature => <li key={feature.key}>{feature.label}: {PLAN_ENTITLEMENTS[plan.plan].features[feature.key] ? "incluído" : "não incluído"}</li>)}</ul></details>)}</div>
    </details>
  </section>;
}
