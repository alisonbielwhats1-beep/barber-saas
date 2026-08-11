const LOYALTY_TIERS = [
  { name: "Novo", visits: 0 },
  { name: "Bronze", visits: 1 },
  { name: "Prata", visits: 3 },
  { name: "Ouro", visits: 8 },
  { name: "Diamante", visits: 16 },
] as const;

export function loyaltyProgress(rawVisits: number) {
  const points = Math.max(0, Math.floor(rawVisits));
  let currentIndex = 0;
  for (let index = 0; index < LOYALTY_TIERS.length; index += 1) {
    if (points >= LOYALTY_TIERS[index].visits) currentIndex = index;
  }
  const current = LOYALTY_TIERS[currentIndex];
  const next = LOYALTY_TIERS[currentIndex + 1] ?? null;
  const start = current.visits;
  const end = next?.visits ?? start;
  const progressPct = next
    ? Math.round(((points - start) / Math.max(1, end - start)) * 100)
    : 100;

  return {
    points,
    currentTier: current.name,
    nextTier: next?.name ?? null,
    remaining: next ? Math.max(0, next.visits - points) : 0,
    progressPct: Math.min(100, Math.max(0, progressPct)),
  };
}

function brl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Math.max(0, cents) / 100).replace(/\u00a0/g, " ");
}

export function buildManualPixMessage(input: {
  salonName: string;
  pixKey: string;
  amountCents: number;
  bookingUrl: string;
}): string {
  return [
    `Olá! Para reservar seu horário no ${input.salonName}, envie o sinal de ${brl(input.amountCents)} via Pix.`,
    `Chave Pix: ${input.pixKey.trim()}`,
    "Depois, envie o comprovante por aqui. A confirmação manual será feita pelo estabelecimento.",
    `Agendamento: ${input.bookingUrl}`,
  ].join("\n\n");
}

export function buildReferralMessage(input: { salonName: string; bookingUrl: string }): string {
  return `Quero te indicar o ${input.salonName}! Você pode conhecer os serviços e agendar direto por aqui: ${input.bookingUrl}`;
}
