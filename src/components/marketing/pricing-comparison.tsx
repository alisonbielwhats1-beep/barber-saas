import { Check } from "lucide-react";
import type { MarketingSegmentId } from "./segments";
import { MarketingPlans } from "./marketing-plans";
import "./pricing.css";

const included = ["Agendamento online e aplicativo do cliente", "Financeiro, relatórios e comissões", "Clientes e histórico de atendimento", "Produtos, estoque e pacotes", "Marketing e portfólio", "Agendamentos ilimitados"];

export function PricingComparison({ segmentId, billingAvailable = false }: { segmentId: MarketingSegmentId; billingAvailable?: boolean }) {
  return <section id="planos" className="pc-section pc-billing mk-wrap" aria-labelledby="pricing-title">
    <div className="pc-heading"><div><p className="mk-eyebrow">UM ESPAÇO PARA CADA TALENTO</p>
      <h2 id="pricing-title">Todos os recursos.<br /><span>O tamanho da sua equipe.</span></h2>
      <p>De quem atende sozinho a quem cuida de uma equipe inteira. Escolha quantas agendas seu espaço precisa e como prefere pagar.</p>
    </div><aside className="pc-capacity-note"><strong>O que muda é a capacidade.</strong><p>Cada agenda organiza os horários de um profissional. Todos os planos pagos incluem os mesmos recursos para cuidar da sua operação.</p></aside></div>
    <MarketingPlans segment={segmentId} billingAvailable={billingAvailable} />
    <div className="pc-included"><h3>Já faz parte de todos os planos</h3><ul>{included.map(item => <li key={item}><Check size={17} aria-hidden="true" />{item}</li>)}</ul></div>
    <p className="pc-next">{billingAvailable
      ? "Escolha seu plano e crie seu espaço ou entre na sua conta. Após a aprovação do estabelecimento, revise a contratação e pague no Mercado Pago. Seu plano é liberado após a confirmação do pagamento."
      : "Você já pode escolher seu plano e criar seu espaço, sem cobrança no cadastro. A contratação online está em preparação; a escolha não ativa uma assinatura."}</p>
  </section>;
}
