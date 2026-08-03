import { SEGMENTS, isSegmentId, type Segment, type SegmentId } from "./segments";

/**
 * Regras de criação de um estabelecimento novo, compartilhadas pelos dois
 * caminhos que criam salão: `/signup` (dono novo) e `/onboarding/create-salon`
 * (usuário sem nenhum vínculo).
 *
 * Estão aqui porque já divergiram uma vez: o onboarding perguntava o segmento e
 * não o gravava, enquanto o signup sequer perguntava. Com a validação num lugar
 * só, um caminho não pode passar a aceitar o que o outro recusa.
 */

export type StarterService = {
  name: string;
  durationMin: number;
  /** Preço fica zerado de propósito — ver `resolveSalonSetup`. */
  priceCents: 0;
  category: string;
};

export type SalonSetup = {
  segment: Segment;
  segmentId: SegmentId;
  services: StarterService[];
};

/**
 * Valida o segmento escolhido e converte os serviços aceitos pelo dono em
 * linhas prontas para o banco.
 *
 * Dois pontos deliberados:
 *
 * 1. Só sobrevivem nomes que realmente constam nas sugestões do segmento
 *    escolhido. O cliente manda uma lista de nomes, e sem esse filtro ele
 *    ditaria o que é criado no banco — inclusive serviço com nome arbitrário.
 *
 * 2. `priceCents` nasce zerado. Inventar preço seria dado falso apresentado ao
 *    cliente final do salão; o dono define cada valor em Serviços.
 */
export function resolveSalonSetup(
  segmentId: string,
  serviceNames: string[],
): { ok: true; setup: SalonSetup } | { ok: false; error: string } {
  if (!isSegmentId(segmentId)) {
    return { ok: false, error: "Tipo de negócio inválido." };
  }

  const segment = SEGMENTS.find((s) => s.id === segmentId)!;
  const allowed = new Map(segment.exampleServices.map((s) => [s.name, s.durationMin]));

  // `Set` evita que o mesmo nome repetido no payload vire serviço duplicado.
  const services = [...new Set(serviceNames)]
    .filter((name) => allowed.has(name))
    .map((name) => ({
      name,
      durationMin: allowed.get(name)!,
      priceCents: 0 as const,
      category: segment.shortLabel,
    }));

  return { ok: true, setup: { segment, segmentId, services } };
}
