"use client";

import { useState } from "react";
import Link from "next/link";
import { AudioLines, CalendarDays, ChartNoAxesColumnIncreasing, Check, LockKeyhole, Mic, Sparkles } from "lucide-react";
import { BILLING_PLANS, quoteContract } from "@/lib/billing/catalog";
import { billingIntentHref, billingMoney, type BillingIntent } from "@/lib/billing/presentation";

const offers = [
  { name: "Individual", description: "Para quem trabalha por conta própria.", plan: "INDIVIDUAL", features: ["1 agenda profissional", "Agendamentos ilimitados", "Link de agendamento online", "Clientes, financeiro e estoque", "Relatórios e marketing"] },
  { name: "Essencial", description: "Para organizar o trabalho em conjunto.", plan: "TEAM", features: ["Até 3 agendas profissionais", "Todos os recursos do Individual", "Agenda de cada profissional", "Permissões para a equipe", "Recepção sem agenda não paga extra"] },
  { name: "Equipe", description: "Mais espaço para o seu negócio.", plan: "TEAM_PLUS", features: ["", "Todos os recursos do Essencial", "Gestão de toda a equipe", "Permissões por profissional", "Recepção sem agenda não paga extra"] },
] as const;

export function MarketingPlans({ billingAvailable = false, segment }: { billingAvailable?: boolean; segment?: string }) {
  const [cycle, setCycle] = useState<BillingIntent["cycle"]>("MONTHLY");
  const [teamSize, setTeamSize] = useState<5 | 10>(5);
  const [extra, setExtra] = useState(0);
  const annual = cycle === "ANNUAL";

  return <div className="offer-picker">
    <fieldset className="offer-cycle"><legend className="sr-only">Periodicidade da cobrança</legend>
      {(["MONTHLY", "ANNUAL"] as const).map(value => <label key={value} data-selected={cycle === value}>
        <input className="sr-only" type="radio" name="marketing-billing-cycle" checked={cycle === value} onChange={() => setCycle(value)} />
        {value === "MONTHLY" ? "Mensal" : "Anual"}
      </label>)}<span>Economize no anual</span>
    </fieldset>
    <div className="offer-grid">{offers.map(offer => {
      const team = offer.plan === "TEAM_PLUS";
      const intent: BillingIntent = { plan: team && teamSize === 10 ? "TEAM_MAX" : offer.plan, cycle, extraAgendas: team && teamSize === 10 ? extra : 0 };
      const quote = quoteContract(intent);
      const saving = quoteContract({ ...intent, cycle: "MONTHLY" }).amountCents * 12 - quote.amountCents;
      const href = billingIntentHref(intent, billingAvailable ? "/contratar" : "/signup") + (segment ? `&segment=${encodeURIComponent(segment)}` : "");
      return <article className={`offer-card${team ? " offer-card-team" : ""}`} key={offer.plan} aria-label={`Plano ${offer.name}`}>
        <div className="offer-title"><h3>{offer.name}</h3>{team && <span>Para crescer</span>}</div>
        <p className="offer-description">{offer.description}</p>
        <p className="offer-price">{billingMoney(quote.amountCents)}<small>/{annual ? "ano" : "mês"}</small></p>
        <div className="offer-terms">{team ? <>
          <fieldset className="offer-capacity"><legend className="sr-only">Agendas incluídas no Equipe</legend>
            {([5, 10] as const).map(size => <label key={size} data-selected={teamSize === size}><input className="sr-only" type="radio" name="marketing-team-size" checked={teamSize === size} onChange={() => setTeamSize(size)} />{size} agendas</label>)}
          </fieldset>
          <p>{teamSize === 5 ? `10 agendas: ${billingMoney(annual ? BILLING_PLANS.TEAM_MAX.annual : BILLING_PLANS.TEAM_MAX.monthly)}/${annual ? "ano" : "mês"}` : `${quote.agendaLimit} agendas no total`}</p>
        </> : <p>{annual ? "Pagamento único por 12 meses." : "Cobrança mensal."}<br />{billingAvailable ? "Cancele a renovação quando quiser." : "Sem cobrança ao escolher."}</p>}
        {annual && <p className="offer-saving">Economize {billingMoney(saving)} em relação a 12 mensalidades.</p>}</div>
        <ul className="offer-features">{offer.features.map((feature, index) => <li key={index}><Check aria-hidden="true" size={20} />{team && index === 0 ? `Até ${quote.agendaLimit} agendas profissionais` : feature}</li>)}</ul>
        <div className="offer-bottom">
          {team ? <div className="offer-note"><p>+ {billingMoney(annual ? 14400 : 1500)}/{annual ? "ano" : "mês"} por agenda extra</p><p>Somente acima de 10 agendas.</p>
            {teamSize === 10 && <div className="offer-extra"><label htmlFor="marketing-extras">Agendas adicionais às 10 incluídas</label><input id="marketing-extras" type="number" min={0} max={100} step={1} value={extra} onChange={e => setExtra(Math.min(100, Math.max(0, Math.trunc(Number(e.target.value) || 0))))} /></div>}
          </div> : <div className="offer-note">{offer.plan === "INDIVIDUAL" ? <>Vai atender com mais alguém?<br /><strong>Conheça o Essencial.</strong></> : <>Sua equipe conectada em uma única agenda.</>}</div>}
          <Link className="offer-cta" href={href}>Escolher {offer.name}</Link>
        </div>
      </article>;
    })}
      <article className="offer-card offer-card-ai" aria-label="Everflair IA, em breve">
        <div className="offer-ai-title"><Sparkles aria-hidden="true" size={28} /><div><h3>Everflair IA</h3><span>Inteligência integrada</span></div></div>
        <p className="offer-description">Seu secretário inteligente.</p>
        <span className="offer-soon"><LockKeyhole aria-hidden="true" size={20} />Em breve</span>
        <div className="offer-ai-preview"><p>Prévia do assistente</p><AudioLines className="offer-wave" aria-hidden="true" size={76} strokeWidth={1.2} />
          <div className="offer-ai-command"><Mic aria-hidden="true" size={21} /><span>Encontre um horário amanhã.</span></div>
          <div className="offer-ai-answer"><Sparkles aria-hidden="true" size={20} /><span>Vou consultar sua agenda.</span></div>
        </div>
        <ul className="offer-ai-features"><li><Mic aria-hidden="true" />Agende por voz ou texto</li><li><CalendarDays aria-hidden="true" />Reagende e cancele com confirmação</li><li><ChartNoAxesColumnIncreasing aria-hidden="true" />Consulte os números do negócio</li></ul>
        <div className="offer-bottom"><p className="offer-ai-footer">Conectado à sua agenda e à sua equipe.</p><button className="offer-cta" type="button" disabled><LockKeyhole aria-hidden="true" size={20} />Disponível em breve</button></div>
      </article>
    </div>
    <p className="offer-footnote">{annual ? "O valor anual é cobrado de uma vez a cada 12 meses. " : ""}{billingAvailable ? "Cancele a renovação quando quiser; o acesso permanece até o fim do período pago." : "Nenhuma cobrança é feita ao escolher um plano. A contratação online está em preparação."} A prévia da IA é ilustrativa; o recurso ainda não está disponível.</p>
  </div>;
}
