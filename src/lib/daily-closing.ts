export type ClosingPaymentMethod =
  | "CASH"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "PIX"
  | "TRANSFER";

export const CLOSING_METHOD_LABELS: Record<ClosingPaymentMethod, string> = {
  CASH: "Dinheiro",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  PIX: "PIX",
  TRANSFER: "Transferência",
};

export type ClosingAppointment = {
  status: string;
  priceCents: number;
  payment: { amountCents: number; method: ClosingPaymentMethod } | null;
};

export type ClosingPayment = {
  amountCents: number;
  method: ClosingPaymentMethod;
};

export type ClosingExpense = {
  amountCents: number;
};

/**
 * Resume um dia sem depender de banco ou de timezone.
 *
 * O fechamento usa pagamentos pela data em que foram recebidos, enquanto as
 * pendências usam a data do atendimento. Assim o número "recebido hoje" não
 * é confundido com a receita produzida hoje.
 */
export function summarizeDailyClosing(input: {
  appointments: ClosingAppointment[];
  payments: ClosingPayment[];
  expenses: ClosingExpense[];
}) {
  const completed = input.appointments.filter((appointment) => appointment.status === "COMPLETED");
  const byMethod = new Map<ClosingPaymentMethod, number>();

  for (const payment of input.payments) {
    byMethod.set(payment.method, (byMethod.get(payment.method) ?? 0) + payment.amountCents);
  }

  const paymentBreakdown = [...byMethod.entries()]
    .sort(([, left], [, right]) => right - left)
    .map(([method, amountCents]) => ({
      method,
      label: CLOSING_METHOD_LABELS[method],
      amountCents,
    }));

  const receivedCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const expensesCents = input.expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const pendingPaymentCents = completed
    .filter((appointment) => appointment.payment === null)
    .reduce((sum, appointment) => sum + appointment.priceCents, 0);

  return {
    appointmentCount: input.appointments.length,
    completedCount: completed.length,
    noShowCount: input.appointments.filter((appointment) => appointment.status === "NO_SHOW").length,
    cancelledCount: input.appointments.filter((appointment) => appointment.status === "CANCELLED").length,
    pendingPaymentCount: completed.filter((appointment) => appointment.payment === null).length,
    pendingPaymentCents,
    receivedCents,
    cashReceivedCents: byMethod.get("CASH") ?? 0,
    expensesCents,
    netCents: receivedCents - expensesCents,
    paymentBreakdown,
  };
}

export type DailyClosingSummary = ReturnType<typeof summarizeDailyClosing>;
