/**
 * Configuração central de status do agendamento (paleta Everflair: âmbar a confirmar, neutro confirmado,
 * lilás em atendimento, verde finalizado, vermelho falta) — cores e rótulos usados
 * tanto no board quanto no popover de detalhe. Cores em hex para uso direto
 * em estilos inline (borda/fundo dos cards).
 */
export type ApptStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export const STATUS: Record<ApptStatus, { label: string; color: string; badgeClass: string }> = {
  PENDING: { label: "A confirmar", color: "#E9A23B", badgeClass: "bg-warning/15 text-warning" },
  CONFIRMED: { label: "Confirmado", color: "#A1A1A1", badgeClass: "bg-muted text-foreground" },
  IN_PROGRESS: { label: "Em atendimento", color: "#B29CF0", badgeClass: "bg-[hsl(var(--selection))] text-[hsl(var(--selection-foreground))]" },
  COMPLETED: { label: "Finalizado", color: "#62C073", badgeClass: "bg-success/15 text-success" },
  NO_SHOW: { label: "Não compareceu", color: "#E5484D", badgeClass: "bg-danger/15 text-danger" },
  CANCELLED: { label: "Cancelado", color: "#8F8F8F", badgeClass: "bg-muted text-muted-foreground" },
};

export const ACTION_LABELS: Partial<Record<ApptStatus, string>> = {
  CONFIRMED: "Confirmar reserva",
  IN_PROGRESS: "Iniciar atendimento",
  COMPLETED: "Concluir atendimento",
  NO_SHOW: "Marcar falta",
};

export function statusActionClasses(status: ApptStatus) {
  return status === "NO_SHOW"
    ? "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/15"
    : "bg-primary text-primary-foreground hover:bg-primary/90";
}

export const STATUS_ORDER: (keyof typeof STATUS)[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
];

/** Transições oferecidas como ações rápidas a partir do status atual. */
export function nextActions(status: string): (keyof typeof STATUS)[] {
  switch (status) {
    case "PENDING":
      return ["CONFIRMED", "NO_SHOW"];
    case "CONFIRMED":
      return ["IN_PROGRESS", "NO_SHOW"];
    case "IN_PROGRESS":
      return ["COMPLETED"];
    default:
      return [];
  }
}

/**
 * A comanda só pode receber depois do início contratado. Atendimentos já
 * concluídos continuam recebíveis enquanto ainda não houver pagamento.
 */
export function canOpenAppointmentCheckout(input: {
  status: string;
  hasPayment: boolean;
  startAt: Date;
  now?: Date;
}): boolean {
  if (input.hasPayment || input.startAt.getTime() > (input.now ?? new Date()).getTime()) {
    return false;
  }
  return input.status === "COMPLETED" ||
    ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(input.status);
}
