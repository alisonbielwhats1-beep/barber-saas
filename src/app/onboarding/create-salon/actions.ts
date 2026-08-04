"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { setSalonGuc, withUser } from "@/lib/prisma-tenant";
import { authOptions } from "@/lib/auth";
import { uniqueSalonSlug } from "@/lib/slug";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { resolveSalonSetup } from "@/lib/salon-setup";

const input = z.object({
  salonName: z.string().min(2, "Nome do estabelecimento muito curto").max(80),
  segmentId: z.string(),
  /** Nomes dos serviços sugeridos que o dono manteve marcados. */
  serviceNames: z.array(z.string()).max(20),
});

export type CreateSalonInput = z.infer<typeof input>;

/**
 * Cria o estabelecimento de um usuário que ainda não pertence a nenhum.
 *
 * Existe porque `getTenantContext()` redireciona para cá quando o usuário tem
 * zero memberships — situação real e alcançável: o dono pode remover alguém da
 * equipe em /configuracoes, e esse usuário continua existindo sem salão algum.
 * Antes essa rota não existia e a pessoa batia num 404 sem saída.
 *
 * O segmento decide quais serviços nascem com o salão e fica gravado em
 * `Salon.segment`, alimentando a vitrine pública. Ele já era perguntado aqui
 * antes da coluna existir, e por um tempo a escolha era descartada em silêncio.
 */
export async function createSalon(
  raw: CreateSalonInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const userId = session.user.id;

  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const data = parsed.data;

  const limited = await checkRateLimit({
    namespace: "salon-create",
    identifier: clientIp(await headers()),
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!limited.allowed) {
    return { ok: false, error: "Muitas tentativas. Aguarde e tente novamente." };
  }

  // Guarda essencial: sem isto, qualquer usuário logado criaria salões à vontade
  // chamando a action direto. Quem já tem salão não passa por aqui.
  // withUser, não prisma cru: sob RLS, Membership só é legível por userId
  // OU salonId — sem a GUC de usuário, esta contagem sempre voltaria zero e
  // a guarda seria contornada em silêncio.
  const existing = await withUser(userId, (tx) => tx.membership.count({ where: { userId } }));
  if (existing > 0) {
    return { ok: false, error: "Você já pertence a um estabelecimento." };
  }

  const resolved = resolveSalonSetup(data.segmentId, data.serviceNames);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { segmentId, services } = resolved.setup;

  const slug = await uniqueSalonSlug(data.salonName);

  await prisma.$transaction(async (tx) => {
    const salon = await tx.salon.create({
      data: { slug, name: data.salonName, plan: "FREE", segment: segmentId },
      select: { id: true },
    });
    // A partir daqui, Membership e Service exigem a GUC do salão recém-criado.
    await setSalonGuc(tx, salon.id);
    await tx.membership.create({
      data: { userId, salonId: salon.id, role: "OWNER" },
    });
    if (services.length > 0) {
      await tx.service.createMany({
        data: services.map((s) => ({ salonId: salon.id, ...s })),
      });
    }
  });

  return { ok: true };
}
