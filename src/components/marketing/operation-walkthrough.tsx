import { ArrowRight, CalendarCheck, CheckCircle2, RotateCcw, Wallet } from "lucide-react";

export const OPERATION_STEPS = [
  { label: "Reserva", title: "O cliente reserva. Sua agenda recebe.", copy: "Mariana escolheu o serviço, a profissional e o horário no aplicativo do cliente. A reserva aparece na agenda da equipe.", status: "Reserva confirmada", action: "Concluir atendimento", Icon: CalendarCheck },
  { label: "Atendimento", title: "Atendimento concluído. Histórico atualizado.", copy: "A equipe conclui o serviço. O valor passa a contar como realizado; isso ainda não significa que foi recebido.", status: "Atendimento concluído · ainda não recebido", action: "Registrar recebimento manual", Icon: CheckCircle2 },
  { label: "Recebimento", title: "Você recebe. O sistema organiza o registro.", copy: "A equipe registra R$ 80,00 recebidos por Pix. O dinheiro é recebido pelo estabelecimento, fora da Everflair.", status: "Recebimento registrado · Pix · R$ 80,00", action: "Conferir no financeiro", Icon: Wallet },
  { label: "Financeiro", title: "Do atendimento aos valores que você acompanha.", copy: "O serviço realizado, o recebimento e a comissão ficam separados. Neste exemplo, a regra de comissão é de 40% sobre o serviço.", status: "Realizado R$ 80,00 · recebido R$ 80,00 · comissão R$ 32,00", action: "Recomeçar demonstração", Icon: Wallet },
] as const;

export function OperationWalkthrough({ step, onStep }: { step: number; onStep: (step: number) => void }) {
  const current = OPERATION_STEPS[step];
  return <div className="ow-demo" aria-label="Demonstração guiada da operação">
    <div className="ow-heading"><span>EXPERIMENTE UMA ROTINA CONECTADA</span><small>Demonstração · dados fictícios</small></div>
    <div className="ow-steps" role="group" aria-label="Etapas da demonstração">{OPERATION_STEPS.map((item, index) => <button key={item.label} type="button" aria-pressed={step === index} onClick={() => onStep(index)}><span>{index + 1}</span>{item.label}</button>)}</div>
    <div className="ow-content"><div className="ow-copy"><current.Icon size={22} aria-hidden="true" /><h3>{current.title}</h3><p>{current.copy}</p></div>
      <div className="ow-record">{step === 3 ? <dl className="ow-totals"><div><dt>Realizado</dt><dd>R$ 80,00</dd></div><div><dt>Recebido</dt><dd>R$ 80,00</dd></div><div><dt>Comissão</dt><dd>R$ 32,00</dd></div></dl> : <><span>MARIANA SOUZA · ANA MARTINS</span><strong>Corte e finalização</strong><p>09:00–10:00 · R$ 80,00</p><b>{step === 0 ? "Confirmado" : step === 1 ? "Concluído · a receber" : "Concluído · recebido"}</b></>}
      <button type="button" className="mk-button" onClick={() => onStep(step === 3 ? 0 : step + 1)}>{current.action}{step === 3 ? <RotateCcw size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}</button></div>
    </div><p className="sr-only" role="status">{current.status}</p>
  </div>;
}
