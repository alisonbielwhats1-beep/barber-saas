export type AgendaColorMode =
  "professional" | "service" | "category" | "status";
export const AGENDA_COLOR_MODES: { value: AgendaColorMode; label: string }[] = [
  { value: "professional", label: "Profissional" },
  { value: "service", label: "Serviço" },
  { value: "category", label: "Categoria" },
  { value: "status", label: "Status" },
];
export function categoryColor(category: string) {
  const palette = [
    "#4B91D1",
    "#A07ACA",
    "#35A58C",
    "#D38D50",
    "#D272A1",
    "#91A94E",
    "#6B9FA8",
  ];
  let hash = 0;
  for (const char of category.trim().toLocaleLowerCase("pt-BR"))
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}
export function appointmentColor(
  mode: AgendaColorMode,
  input: {
    professional: string;
    service?: string | null;
    category?: string | null;
    status: string;
  },
) {
  if (mode === "status") return input.status;
  if (mode === "category")
    return categoryColor(input.category || "Sem categoria");
  if (mode === "service")
    return input.service && /^#[a-f\d]{6}$/i.test(input.service)
      ? input.service
      : categoryColor(input.category || "Serviços");
  return input.professional;
}
