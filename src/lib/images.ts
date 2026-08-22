/**
 * Curadoria de imagens locais usadas como default quando o dono ainda não fez
 * upload das próprias. Manter os defaults no mesmo deploy evita dependência
 * de rede, falhas de proxy e custo de otimização de imagens externas.
 */

const LOCAL_SERVICE_IMAGES = {
  barber: "/images/salon-hero-barber-v2.webp",
  beard: "/images/salon-hero-beard-v1.webp",
  maleHaircut: "/images/salon-hero-male-haircut-v1.webp",
  stylistCut: "/images/salon-hero-stylist-v1.webp",
  stylistFinish: "/images/salon-hero-stylist-v2.webp",
  manicure: "/images/salon-hero-manicure-v1.webp",
  aesthetics: "/images/salon-hero-aesthetics-v2.webp",
  massage: "/images/salon-hero-massage-v2.webp",
} as const;

/**
 * Compatibilidade com registros criados antes da conversão dos masters PNG
 * para WebP. Não altera uploads personalizados nem URLs externas.
 */
export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/(\/images\/[^/?#]+)-hq\.png(?=($|[?#]))/i, "$1.webp");
}

// Hero moody de barbearia — usado no splash
export const HERO_IMAGES = [
  LOCAL_SERVICE_IMAGES.barber,
  LOCAL_SERVICE_IMAGES.maleHaircut,
  LOCAL_SERVICE_IMAGES.beard,
  LOCAL_SERVICE_IMAGES.stylistFinish,
];

// Uma imagem representativa por categoria de serviço.
export const CATEGORY_IMAGES: Record<string, string> = {
  // Cabelo masculino
  barba:            LOCAL_SERVICE_IMAGES.beard,
  sobrancelha:      LOCAL_SERVICE_IMAGES.aesthetics,
  cortemasculino:   LOCAL_SERVICE_IMAGES.maleHaircut,
  quimimasculina:   LOCAL_SERVICE_IMAGES.barber,
  combomaculino:    LOCAL_SERVICE_IMAGES.barber,
  // Cabelo feminino
  cortefeminino:    LOCAL_SERVICE_IMAGES.stylistCut,
  coloracao:        LOCAL_SERVICE_IMAGES.stylistFinish,
  hidratacao:       LOCAL_SERVICE_IMAGES.stylistFinish,
  escova:           LOCAL_SERVICE_IMAGES.stylistFinish,
  quimifeminina:    LOCAL_SERVICE_IMAGES.stylistCut,
  combofeminino:    LOCAL_SERVICE_IMAGES.stylistFinish,
  // Estética
  maquiagem:        LOCAL_SERVICE_IMAGES.stylistFinish,
  unhas:            LOCAL_SERVICE_IMAGES.manicure,
  depilacao:        LOCAL_SERVICE_IMAGES.aesthetics,
  pele:             LOCAL_SERVICE_IMAGES.aesthetics,
  massagem:         LOCAL_SERVICE_IMAGES.massage,
  // Fallback
  default:          LOCAL_SERVICE_IMAGES.barber,
};

export function imageForCategory(category: string): string {
  const n = category
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "");
  // Ordem: mais específico primeiro
  if (n.includes("sobrancelha"))                         return CATEGORY_IMAGES.sobrancelha;
  if (n.includes("barba"))                               return CATEGORY_IMAGES.barba;
  if (n.includes("quimicamasculina") || (n.includes("quimica") && n.includes("masc")))
                                                         return CATEGORY_IMAGES.quimimasculina;
  if (n.includes("quimicafeminina")  || (n.includes("quimica") && n.includes("fem")))
                                                         return CATEGORY_IMAGES.quimifeminina;
  if (n.includes("quimica"))                             return CATEGORY_IMAGES.quimifeminina;
  if (n.includes("combomaculino") || (n.includes("combo") && n.includes("masc")))
                                                         return CATEGORY_IMAGES.combomaculino;
  if (n.includes("combofeminino")  || (n.includes("combo") && n.includes("fem")))
                                                         return CATEGORY_IMAGES.combofeminino;
  if (n.includes("combo"))                               return CATEGORY_IMAGES.combomaculino;
  if (n.includes("cortefeminino")  || n.includes("cortef"))  return CATEGORY_IMAGES.cortefeminino;
  if (n.includes("cortemasculino") || n.includes("cortem"))  return CATEGORY_IMAGES.cortemasculino;
  if (n.includes("corte"))                               return CATEGORY_IMAGES.cortemasculino;
  if (n.includes("escova") || n.includes("prancha") || n.includes("finalizacao"))
                                                         return CATEGORY_IMAGES.escova;
  if (n.includes("coloracao") || n.includes("tinta") || n.includes("luzes"))
                                                         return CATEGORY_IMAGES.coloracao;
  if (n.includes("hidrata") || n.includes("tratamento") || n.includes("nutri") || n.includes("reconstru"))
                                                         return CATEGORY_IMAGES.hidratacao;
  if (n.includes("maquiagem"))                           return CATEGORY_IMAGES.maquiagem;
  if (n.includes("unha") || n.includes("manicure") || n.includes("pedicure") || n.includes("nail"))
                                                         return CATEGORY_IMAGES.unhas;
  if (n.includes("massagem") || n.includes("drenagem") || n.includes("relaxante"))
                                                         return CATEGORY_IMAGES.massagem;
  if (n.includes("depila") || n.includes("cera"))        return CATEGORY_IMAGES.depilacao;
  if (n.includes("pele") || n.includes("cuidados") || n.includes("limpeza"))
                                                         return CATEGORY_IMAGES.pele;
  if (n.includes("estetica") || n.includes("facial"))     return CATEGORY_IMAGES.pele;
  return CATEGORY_IMAGES.default;
}

// mantido como fallback para upload personalizado
export function imageForService(name: string): string {
  return imageForCategory(name);
}

/** Banner da categoria para o catálogo administrativo. */
export function bannerForCategory(category: string): string {
  return imageForCategory(category);
}

// Produtos demonstrativos. O conjunto antigo continha IDs que hoje retornam
// tênis e brinquedos; estas opções foram verificadas visualmente e permanecem
// relacionadas a cosméticos, cabelo ou barbearia.
export const PRODUCT_IMAGES = [
  LOCAL_SERVICE_IMAGES.aesthetics,
  LOCAL_SERVICE_IMAGES.massage,
  LOCAL_SERVICE_IMAGES.stylistFinish,
  LOCAL_SERVICE_IMAGES.beard,
  LOCAL_SERVICE_IMAGES.maleHaircut,
  LOCAL_SERVICE_IMAGES.manicure,
];

const LEGACY_DEMO_PRODUCT_IDS = [
  "photo-1631730486572-226d1f595b68",
  "photo-1620916566398-39f1143ab7be",
  "photo-1608248543803-ba4f8c70ae0b",
  "photo-1599351431202-1e0f0137899a",
  "photo-1585232004423-244e0e6904e3", // tênis, antes usado como óleo para barba
  "photo-1590540179852-2110a54f813a",
  "photo-1608248597279-f99d160bfcbc",
  "photo-1594736797933-d0501ba2fe65", // brinquedo, antes usado como tratamento
] as const;

export function imageForProduct(index: number): string {
  return PRODUCT_IMAGES[index % PRODUCT_IMAGES.length];
}

type ProductImageInput = {
  imageUrl?: string | null;
  name: string;
  category?: string | null;
  index?: number;
};

/**
 * Preserva uploads do estabelecimento e corrige somente placeholders antigos
 * do catálogo demonstrativo. O nome/categoria decide a imagem quando o URL
 * legado não corresponde ao produto.
 */
export function resolveProductImage({
  imageUrl,
  name,
  category,
  index = 0,
}: ProductImageInput): string {
  const isLegacyDemoImage = imageUrl
    ? LEGACY_DEMO_PRODUCT_IDS.some((id) => imageUrl.includes(id))
    : false;

  if (imageUrl && !isLegacyDemoImage) return normalizeImageUrl(imageUrl) ?? imageForProduct(index);

  const normalized = `${name} ${category ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized.includes("barba") || normalized.includes("navalha")) {
    return LOCAL_SERVICE_IMAGES.beard;
  }
  if (
    normalized.includes("shampoo") ||
    normalized.includes("mascara") ||
    normalized.includes("hidrata") ||
    normalized.includes("oleo") ||
    normalized.includes("leave-in")
  ) {
    return PRODUCT_IMAGES[2];
  }
  if (
    normalized.includes("pomada") ||
    normalized.includes("modelador") ||
    normalized.includes("escova") ||
    normalized.includes("finalizador")
  ) {
    return PRODUCT_IMAGES[4];
  }
  if (normalized.includes("maqui") || normalized.includes("cosmet")) {
    return PRODUCT_IMAGES[0];
  }

  return imageForProduct(index);
}

// Portfolio (galeria de cortes) — pool para dados demo
export const PORTFOLIO_POOL = [
  LOCAL_SERVICE_IMAGES.barber,
  LOCAL_SERVICE_IMAGES.maleHaircut,
  LOCAL_SERVICE_IMAGES.beard,
  LOCAL_SERVICE_IMAGES.stylistCut,
  LOCAL_SERVICE_IMAGES.stylistFinish,
  LOCAL_SERVICE_IMAGES.manicure,
  LOCAL_SERVICE_IMAGES.aesthetics,
  LOCAL_SERVICE_IMAGES.massage,
  LOCAL_SERVICE_IMAGES.barber,
];

const LEGACY_DEMO_PORTFOLIO_IDS = [
  "photo-1622287162716-f311baa1a2b8",
  "photo-1621605815971-fbc98d665033",
  "photo-1560066984-138dadb4c035",
  "photo-1580618672591-eb180b1a973f",
  "photo-1522337660859-02fbefca4702",
  "photo-1503951914875-452162b0f3f1",
] as const;

/**
 * Migra visualmente os itens demo antigos que apontavam para Unsplash. URLs
 * personalizadas do estabelecimento continuam sendo respeitadas.
 */
export function resolvePortfolioImage(url: string | null | undefined, index = 0): string {
  if (!url) return PORTFOLIO_POOL[index % PORTFOLIO_POOL.length];
  const legacyIndex = LEGACY_DEMO_PORTFOLIO_IDS.findIndex((id) => url.includes(id));
  if (legacyIndex >= 0) return PORTFOLIO_POOL[legacyIndex % PORTFOLIO_POOL.length];
  return normalizeImageUrl(url) ?? PORTFOLIO_POOL[index % PORTFOLIO_POOL.length];
}
