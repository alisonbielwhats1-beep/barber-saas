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

// Uma imagem representativa por categoria de serviço
export const CATEGORY_IMAGES: Record<string, string> = {
  barba:          w("photo-1621607512214-68297480165e"),
  sobrancelha:    w("photo-1596728325488-58c87691e9af"),
  cortemasculino: w("photo-1621605815971-fbc98d665033"),
  cortefeminino:  w("photo-1560066984-138dadb4c035"),
  coloracao:      w("photo-1580618672591-eb180b1a973f"),
  hidratacao:     w("photo-1522337660859-02fbefca4702"),
  escova:         w("photo-1522338242992-e1a54906a8da"),
  quimica:        w("photo-1580618672591-eb180b1a973f"),
  combo:          w("photo-1503951914875-452162b0f3f1"),
  depilacao:      w("photo-1585747860715-2ba37e788b70"),
  maquiagem:      w("photo-1512690459411-b9245aed614b"),
  unhas:          w("photo-1622287162716-f311baa1a2b8"),
  pele:           w("photo-1585747860715-2ba37e788b70"),
  default:        w("photo-1503951914875-452162b0f3f1"),
};

export function imageForCategory(category: string): string {
  const n = category
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "");
  if (n.includes("barba")) return CATEGORY_IMAGES.barba;
  if (n.includes("sobrancelha")) return CATEGORY_IMAGES.sobrancelha;
  if (n.includes("quimica")) return CATEGORY_IMAGES.quimica;
  if (n.includes("cortef") || n.includes("cortefeminino")) return CATEGORY_IMAGES.cortefeminino;
  if (n.includes("cortem") || n.includes("cortemasculino")) return CATEGORY_IMAGES.cortemasculino;
  if (n.includes("corte")) return CATEGORY_IMAGES.cortemasculino;
  if (n.includes("escova") || n.includes("prancha")) return CATEGORY_IMAGES.escova;
  if (n.includes("coloracao")) return CATEGORY_IMAGES.coloracao;
  if (n.includes("hidrata")) return CATEGORY_IMAGES.hidratacao;
  if (n.includes("combo")) return CATEGORY_IMAGES.combo;
  if (n.includes("depila")) return CATEGORY_IMAGES.depilacao;
  if (n.includes("maquiagem")) return CATEGORY_IMAGES.maquiagem;
  if (n.includes("unha")) return CATEGORY_IMAGES.unhas;
  if (n.includes("pele") || n.includes("cuidados")) return CATEGORY_IMAGES.pele;
  return CATEGORY_IMAGES.default;
}

// imageForService mantido apenas como fallback para upload personalizado
export function imageForService(name: string): string {
  return imageForCategory(name);
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
