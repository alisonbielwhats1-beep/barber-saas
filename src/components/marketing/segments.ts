export const MARKETING_SEGMENTS = [
  { id: "salao", label: "Salão de beleza", name: "seu salão", image: "/images/brand-salon.webp", alt: "Profissional cuidando do cabelo de uma cliente em um salão contemporâneo", position: "50% 45%", line: "Mais espaço para criar. Mais clareza para administrar." },
  { id: "barbearia", label: "Barbearia", name: "sua barbearia", image: "/images/brand-barber.webp", alt: "Barbeiro trabalhando em uma barbearia de arquitetura contemporânea", position: "50% 45%", line: "Precisão no atendimento. Controle em cada detalhe." },
  { id: "manicure", label: "Manicure", name: "sua esmalteria", image: "/images/brand-manicure.webp", alt: "Cuidado das unhas em um estúdio de manicure", position: "50% 50%", line: "Cuidado nos detalhes. Organização entre os horários." },
  { id: "estetica", label: "Estética", name: "seu espaço de estética", image: "/images/brand-aesthetics.webp", alt: "Atendimento facial em um espaço de estética", position: "50% 50%", line: "Presença em cada atendimento. Clareza em toda a operação." },
  { id: "bem-estar", label: "Massagem e bem-estar", name: "seu espaço de bem-estar", image: "/images/brand-wellness.webp", alt: "Profissional preparando as toalhas em um estúdio de bem-estar", position: "50% 50%", line: "Uma rotina mais leve para quem cuida de outras pessoas." },
  { id: "espaco-misto", label: "Espaço misto", name: "seu espaço misto", image: "/images/brand-mixed.webp", alt: "Atendimentos de cabelo e manicure em um espaço integrado de beleza e bem-estar", position: "50% 50%", line: "Diferentes talentos. Um espaço conectado." },
] as const;
export type MarketingSegmentId = typeof MARKETING_SEGMENTS[number]["id"];
export const SEGMENT_STORAGE_KEY = "salonsaas:marketing-segment:v1";
export const signupHref = (id: MarketingSegmentId) => `/signup?segment=${encodeURIComponent(id)}`;
export const SIGNUP_SEGMENTS = {
  salao: "salao-beleza", barbearia: "barbearia", manicure: "manicure-nail",
  estetica: "estetica-bemestar", "bem-estar": "estetica-bemestar", "espaco-misto": "espaco-misto",
} as const;
export function resolveMarketingSegment(value: string | null) {
  return MARKETING_SEGMENTS.find((segment) => segment.id === value) ?? MARKETING_SEGMENTS[0];
}
