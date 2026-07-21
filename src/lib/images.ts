/**
 * Curadoria de imagens Unsplash — usadas como default quando o dono do salão
 * ainda não fez upload das próprias. As URLs terminam em `photo-...` (fixas,
 * não vão sumir). Ao ligar upload no admin depois, essas ficam apenas como
 * fallback.
 *
 * Todas as imagens são servidas pelo domínio `images.unsplash.com` já
 * whitelisted em `next.config.mjs`.
 */

const w = (id: string, size = 800) =>
  `https://images.unsplash.com/${id}?w=${size}&auto=format&fit=crop&q=80`;

// Hero moody de barbearia — usado no splash
export const HERO_IMAGES = [
  w("photo-1503951914875-452162b0f3f1", 1200), // barbershop classic
  w("photo-1622287162716-f311baa1a2b8", 1200), // barber tools
  w("photo-1585747860715-2ba37e788b70", 1200), // client + barber
  w("photo-1512690459411-b9245aed614b", 1200), // dark barber chair
];

// Serviços — mapeados por heurística de nome
export const SERVICE_IMAGES: Record<string, string> = {
  corte: w("photo-1622286342621-4bd786c2447c"),
  cortemasculino: w("photo-1621605815971-fbc98d665033"),
  cortefeminino: w("photo-1560066984-138dadb4c035"),
  coloracao: w("photo-1580618672591-eb180b1a973f"),
  hidratacao: w("photo-1522337660859-02fbefca4702"),
  escova: w("photo-1522338242992-e1a54906a8da"),
  barba: w("photo-1621607512214-68297480165e"),
  hot: w("photo-1596728325488-58c87691e9af"),
  default: w("photo-1503951914875-452162b0f3f1"),
};

export function imageForService(name: string): string {
  const n = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "");
  if (n.includes("coloracao") || n.includes("tinta")) return SERVICE_IMAGES.coloracao;
  if (n.includes("hidrata")) return SERVICE_IMAGES.hidratacao;
  if (n.includes("escova") || n.includes("finaliza")) return SERVICE_IMAGES.escova;
  if (n.includes("barba")) return SERVICE_IMAGES.barba;
  if (n.includes("hot") || n.includes("toalha")) return SERVICE_IMAGES.hot;
  if (n.includes("cortefeminino") || n.includes("cortef")) return SERVICE_IMAGES.cortefeminino;
  if (n.includes("cortemasculino") || n.includes("cortem")) return SERVICE_IMAGES.cortemasculino;
  if (n.includes("corte")) return SERVICE_IMAGES.corte;
  return SERVICE_IMAGES.default;
}

// Produtos (grooming, hair care) — usados como placeholder de vitrine
export const PRODUCT_IMAGES = [
  w("photo-1631730486572-226d1f595b68", 600), // pomade jar
  w("photo-1620916566398-39f1143ab7be", 600), // hair oil
  w("photo-1608248543803-ba4f8c70ae0b", 600), // shampoo bottle
  w("photo-1599351431202-1e0f0137899a", 600), // razor
  w("photo-1585232004423-244e0e6904e3", 600), // beard oil
  w("photo-1590540179852-2110a54f813a", 600), // brush
  w("photo-1608248597279-f99d160bfcbc", 600), // aftershave
  w("photo-1594736797933-d0501ba2fe65", 600), // hair styling product
];

export function imageForProduct(index: number): string {
  return PRODUCT_IMAGES[index % PRODUCT_IMAGES.length];
}

// Portfolio (galeria de cortes) — pool para dados demo
export const PORTFOLIO_POOL = [
  w("photo-1622287162716-f311baa1a2b8", 800),
  w("photo-1621605815971-fbc98d665033", 800),
  w("photo-1560066984-138dadb4c035", 800),
  w("photo-1580618672591-eb180b1a973f", 800),
  w("photo-1522337660859-02fbefca4702", 800),
  w("photo-1621607512214-68297480165e", 800),
  w("photo-1596728325488-58c87691e9af", 800),
  w("photo-1503951914875-452162b0f3f1", 800),
  w("photo-1512690459411-b9245aed614b", 800),
];
