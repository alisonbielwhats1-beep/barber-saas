/**
 * Configuração central de status do agendamento — cores e rótulos usados
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

export const STATUS: Record<ApptStatus, { label: string; color: string }> = {
  PENDING: { label: "A confirmar", color: "#F59E0B" },
  CONFIRMED: { label: "Confirmado", color: "#3B9EFF" },
  IN_PROGRESS: { label: "Em atendimento", color: "#A855F7" },
  COMPLETED: { label: "Finalizado", color: "#2ECC8B" },
  NO_SHOW: { label: "Não compareceu", color: "#EF4444" },
  CANCELLED: { label: "Cancelado", color: "#64748B" },
};

export const ACTION_LABELS: Partial<Record<ApptStatus, string>> = {
  CONFIRMED: "Confirmar reserva",
  IN_PROGRESS: "Iniciar atendimento",
  COMPLETED: "Concluir atendimento",
  NO_SHOW: "Marcar falta",
};

export function statusActionClasses(status: ApptStatus) {
  return status === "NO_SHOW"
    ? "bg-[var(--action-critical)] text-white hover:brightness-110"
    : "bg-[var(--action-positive)] text-white hover:brightness-110";
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
