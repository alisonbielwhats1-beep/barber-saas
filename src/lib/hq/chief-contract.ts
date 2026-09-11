export type ChiefSource = { label: string; href: string };
export type ChiefRun = {
  id: string; actorId: string; question: string; answer: string | null;
  status: "running" | "completed" | "failed"; errorCode: string | null;
  createdAt: string; finishedAt: string | null; model: string; promptVersion: string;
  chargeMicros: number; inputTokens: number | null; outputTokens: number | null;
  sources: ChiefSource[];
};
export type ChiefState = {
  ready: boolean; reason: string; budgetMicros: number; committedMicros: number;
  runs: ChiefRun[]; nextCursor: string | null;
};
export const chiefSuggestions = [
  "Quais clientes precisam de atenção?",
  "Quais follow-ups estão atrasados?",
  "Há tickets abertos?",
  "Como está o financeiro?",
] as const;

