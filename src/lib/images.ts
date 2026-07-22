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
// IDs verificados no Unsplash — não alterar sem verificar no browser
export const CATEGORY_IMAGES: Record<string, string> = {
  // Cabelo masculino
  barba:            w("photo-1621607512214-68297480165e"), // homem aparando barba
  sobrancelha:      w("photo-1519415387722-a1c3bbef716c"), // design de sobrancelha
  cortemasculino:   w("photo-1621605815971-fbc98d665033"), // corte masculino
  quimimasculina:   w("photo-1524582603048-cdeb7f943d0a"), // química/tintura em homem
  combomaculino:    w("photo-1503951914875-452162b0f3f1"), // barbearia geral
  // Cabelo feminino
  cortefeminino:    w("photo-1560066984-138dadb4c035"), // corte feminino
  coloracao:        w("photo-1580618672591-eb180b1a973f"), // coloração feminina
  hidratacao:       w("photo-1522337660859-02fbefca4702"), // hidratação/tratamento
  escova:           w("photo-1522338242992-e1a54906a8da"), // escova e prancha
  quimifeminina:    w("photo-1580618672591-eb180b1a973f"), // química feminina
  combofeminino:    w("photo-1622286342621-4bd786c2447c"), // finalização feminina
  // Estética
  maquiagem:        w("photo-1596462502278-27bfdc403348"), // maquiagem (real)
  unhas:            w("photo-1604654894610-df63bc536371"), // unhas/manicure (real)
  depilacao:        w("photo-1512496015851-a90fb38ba796"), // depilação (real)
  pele:             w("photo-1655029635663-aac10b088cd1"), // skincare (real)
  // Fallback
  default:          w("photo-1503951914875-452162b0f3f1"),
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
  if (n.includes("unha"))                                return CATEGORY_IMAGES.unhas;
  if (n.includes("depila") || n.includes("cera"))        return CATEGORY_IMAGES.depilacao;
  if (n.includes("pele") || n.includes("cuidados") || n.includes("limpeza"))
                                                         return CATEGORY_IMAGES.pele;
  return CATEGORY_IMAGES.default;
}

// mantido como fallback para upload personalizado
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
