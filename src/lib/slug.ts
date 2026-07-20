import { prisma } from "./prisma";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Garante slug único na tabela Salon. Tenta o slug base; se já existe, tenta
 * `base-2`, `base-3`, … até achar livre. Não usa random pra manter URLs limpas
 * (`/book/luna-hair` melhor que `/book/luna-hair-x7k`).
 */
export async function uniqueSalonSlug(base: string): Promise<string> {
  const slug = slugify(base) || "salao";
  let candidate = slug;
  let n = 2;
  // Loop máximo defensivo — na prática resolve em 1-2 iterações
  while (n < 100) {
    const exists = await prisma.salon.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
    candidate = `${slug}-${n}`;
    n++;
  }
  throw new Error("Não foi possível gerar um slug único");
}
