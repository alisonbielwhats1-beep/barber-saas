import type { LucideIcon } from "lucide-react";
import { Scissors, Sparkles, Gem, Waves, LayoutGrid } from "lucide-react";
import { CATEGORY_IMAGES, HERO_IMAGES, SEGMENT_IMAGES } from "./images";

/**
 * Segmentos de negócio suportados pela plataforma — hoje é só apresentação
 * (homepage comercial). Quando `Salon` ganhar um campo de segmento persistido
 * (migration futura, fora deste lote), os componentes que consomem `SEGMENTS`
 * e `getSegment()` não precisam mudar de forma: troca-se apenas a origem do
 * `SegmentId` (estado local → valor vindo do server).
 *
 * O segmento personaliza texto/imagem/exemplo — nunca restringe o que um
 * estabelecimento pode cadastrar em Serviços (Service.category continua livre).
 */

export type SegmentId =
  | "barbearia"
  | "salao-beleza"
  | "manicure-nail"
  | "estetica-bemestar"
  | "espaco-misto";

export type Segment = {
  id: SegmentId;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  /**
   * Serviços típicos do segmento. Usados em dois lugares:
   *  - homepage comercial, como exemplo do que o segmento atende;
   *  - onboarding, como sugestão pré-marcada — o dono desmarca o que não faz.
   * Nunca são cadastrados sem o dono confirmar. Preço fica em branco de
   * propósito: inventar preço é o tipo de dado falso que não entra aqui.
   */
  exampleServices: { name: string; durationMin: number }[];
  /** Bullets curtos para a seção "recursos por segmento" da homepage. */
  highlights: string[];
  /** Imagem única representativa (cards, seletor). */
  accentImage: string;
  /** Pool para rotação em seções maiores (hero, demonstração). */
  heroImages: string[];
};

export const SEGMENTS: Segment[] = [
  {
    id: "barbearia",
    label: "Barbearia",
    shortLabel: "Barbearia",
    description: "Corte, barba e cuidado masculino com agenda própria por profissional.",
    icon: Scissors,
    exampleServices: [
      { name: "Corte masculino", durationMin: 30 },
      { name: "Barba", durationMin: 30 },
      { name: "Corte e barba", durationMin: 60 },
      { name: "Pezinho", durationMin: 15 },
      { name: "Sobrancelha", durationMin: 15 },
      { name: "Pigmentação", durationMin: 45 },
    ],
    highlights: [
      "Corte e barba no mesmo atendimento",
      "Profissionais com agendas separadas",
      "Pacotes de serviços",
      "Controle de produtos",
      "Retorno do cliente facilitado",
    ],
    accentImage: SEGMENT_IMAGES.barbearia,
    heroImages: HERO_IMAGES,
  },
  {
    id: "salao-beleza",
    label: "Salão de beleza e cabeleireiro",
    shortLabel: "Salão",
    description: "Cortes, coloração e tratamentos capilares com vários profissionais e serviços.",
    icon: Sparkles,
    exampleServices: [
      { name: "Corte feminino", durationMin: 60 },
      { name: "Escova", durationMin: 45 },
      { name: "Coloração", durationMin: 120 },
      { name: "Mechas", durationMin: 180 },
      { name: "Progressiva", durationMin: 180 },
      { name: "Hidratação", durationMin: 60 },
    ],
    highlights: [
      "Serviços com durações diferentes",
      "Vários profissionais na mesma agenda",
      "Produtos e tratamentos",
      "Histórico completo do cliente",
      "Pacotes e recorrência",
    ],
    accentImage: SEGMENT_IMAGES.salao,
    heroImages: [SEGMENT_IMAGES.salao, CATEGORY_IMAGES.coloracao, CATEGORY_IMAGES.escova],
  },
  {
    id: "manicure-nail",
    label: "Manicure e nail designer",
    shortLabel: "Manicure",
    description: "Esmaltação, alongamento e nail art com portfólio de trabalhos em destaque.",
    icon: Gem,
    exampleServices: [
      { name: "Manicure", durationMin: 45 },
      { name: "Pedicure", durationMin: 45 },
      { name: "Esmaltação em gel", durationMin: 60 },
      { name: "Alongamento", durationMin: 120 },
      { name: "Nail art", durationMin: 30 },
      { name: "Spa dos pés", durationMin: 60 },
    ],
    highlights: [
      "Manutenção de alongamento",
      "Serviços recorrentes",
      "Portfólio de trabalhos",
      "Agendamento por duração",
      "Histórico e preferências do cliente",
    ],
    accentImage: SEGMENT_IMAGES.manicure,
    heroImages: [SEGMENT_IMAGES.manicure],
  },
  {
    id: "estetica-bemestar",
    label: "Estética, massagem e bem-estar",
    shortLabel: "Estética",
    description: "Sessões, pacotes e tratamentos com foco em frequência e evolução do cliente.",
    icon: Waves,
    exampleServices: [
      { name: "Massagem relaxante", durationMin: 60 },
      { name: "Drenagem linfática", durationMin: 60 },
      { name: "Limpeza de pele", durationMin: 90 },
      { name: "Design de sobrancelha", durationMin: 30 },
      { name: "Depilação", durationMin: 45 },
    ],
    highlights: [
      "Sessões e pacotes",
      "Acompanhamento de frequência",
      "Evolução do atendimento",
      "Horários por profissional",
      "Tratamentos faciais e corporais",
    ],
    accentImage: SEGMENT_IMAGES.estetica,
    heroImages: [SEGMENT_IMAGES.estetica, CATEGORY_IMAGES.depilacao],
  },
  {
    id: "espaco-misto",
    label: "Espaço misto",
    shortLabel: "Misto",
    description: "Cabelo, unhas, estética e mais — tudo em um só espaço, sem travar categorias.",
    icon: LayoutGrid,
    exampleServices: [
      { name: "Corte", durationMin: 45 },
      { name: "Barba", durationMin: 30 },
      { name: "Manicure", durationMin: 45 },
      { name: "Sobrancelha", durationMin: 15 },
      { name: "Maquiagem", durationMin: 60 },
      { name: "Limpeza de pele", durationMin: 90 },
    ],
    highlights: [
      "Categorias combinadas livremente",
      "Cada profissional com sua especialidade",
      "Um catálogo, vários segmentos",
      "Sem necessidade de outra conta para crescer",
      "Relatórios unificados",
    ],
    accentImage: SEGMENT_IMAGES.misto,
    heroImages: [SEGMENT_IMAGES.misto, CATEGORY_IMAGES.unhas, CATEGORY_IMAGES.pele],
  },
];

export const DEFAULT_SEGMENT_ID: SegmentId = SEGMENTS[0].id;

export function getSegment(id: SegmentId): Segment {
  return SEGMENTS.find((s) => s.id === id) ?? SEGMENTS[0];
}

/**
 * `Salon.segment` é texto livre no banco (não enum), então qualquer valor
 * pode chegar ali — inclusive de uma versão antiga do formulário ou edição
 * manual. Este guard é o que decide se dá para tratar como SegmentId ou se é
 * mais seguro tratar como "sem segmento definido".
 */
export function isSegmentId(value: string | null | undefined): value is SegmentId {
  return !!value && SEGMENTS.some((s) => s.id === value);
}
