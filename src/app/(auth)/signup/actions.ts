"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { setSalonGuc, setUserGuc } from "@/lib/prisma-tenant";
import { uniqueSalonSlug } from "@/lib/slug";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { resolveSalonSetup } from "@/lib/salon-setup";
import { notifyPlatformAdminOfSignup } from "@/lib/platform-signup-notification";
import { recordSalonAccessRequest } from "@/lib/salon-access-request";

const signupInput = z.object({
  ownerName: z.string().min(2, "Nome muito curto"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha precisa ter ao menos 6 caracteres"),
  salonName: z.string().min(2, "Nome do salão muito curto"),
  segmentId: z.string(),
  /** Nomes das sugestões que o dono manteve marcadas. */
  serviceNames: z.array(z.string()).max(20),
});

export type SignupInput = z.infer<typeof signupInput>;

/**
 * Cria conta do dono + salão + membership OWNER em uma transação, já com o
 * segmento escolhido e os serviços iniciais que ele confirmou. Retorna
 * `{ slug }` para o client redirecionar corretamente.
 *
 * O segmento é perguntado aqui porque este é o único caminho que um dono novo
 * percorre: `/onboarding/create-salon` só é alcançado por quem não tem vínculo
 * nenhum, o que nunca acontece logo após o cadastro.
 *
 * Não criamos `WorkingHours` — o modelo é por profissional, e nenhum existe
 * ainda neste ponto. O horário nasce junto do primeiro profissional.
 *
 * Falhas comuns retornadas como `{ error }` em vez de throw pra melhor UX:
 *  - email já cadastrado
 *  - validação Zod
 */
export async function signup(input: SignupInput): Promise<
  { ok: true; slug: string } | { ok: false; error: string }
> {
  const parsed = signupInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const data = parsed.data;
  const email = data.email.toLowerCase().trim();
  const requestHeaders = await headers();
  const limited = await checkRateLimit({
    namespace: "salon-signup",
    identifier: clientIp(requestHeaders),
    limit: 5,
    windowSeconds: 60 * 60,
    failClosed: true,
  });
  if (!limited.allowed) {
    if (limited.source === "unavailable") {
      return { ok: false, error: "Serviço de segurança temporariamente indisponível." };
    }
    return { ok: false, error: "Muitas tentativas. Aguarde e tente novamente." };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "Não foi possível criar a conta com os dados informados." };
  }

  const resolved = resolveSalonSetup(data.segmentId, data.serviceNames);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { segmentId, services } = resolved.setup;

  const passwordHash = await bcrypt.hash(data.password, 10);
  const passwordSetAt = new Date();
  const slug = await uniqueSalonSlug(data.salonName);

  try {
    await prisma.$transaction(async (tx) => {
      // User não é tenant-scoped (sem RLS) — sem GUC necessária até aqui.
      const user = await tx.user.create({
        data: { email, name: data.ownerName, passwordHash, passwordSetAt },
        select: { id: true },
      });
      const salon = await tx.salon.create({
        data: {
          slug,
          name: data.salonName,
          plan: "FREE",
          segment: segmentId,
          accessStatus: "PENDING",
        },
        select: { id: true },
      });
      // A partir daqui, Membership e Service exigem as GUCs recém-criadas.
      await setSalonGuc(tx, salon.id);
      await setUserGuc(tx, user.id);
      await tx.membership.create({
        data: { userId: user.id, salonId: salon.id, role: "OWNER" },
      });
      if (services.length > 0) {
        await tx.service.createMany({
          data: services.map((s) => ({ salonId: salon.id, ...s })),
        });
      }
      await recordSalonAccessRequest(tx, {
        salonId: salon.id,
        actorUserId: user.id,
      });
    });
  } catch (error) {
    const details = error as { code?: unknown; name?: unknown };
    console.error("salon_signup_failed", {
      code: typeof details.code === "string" ? details.code : "unknown",
      name: typeof details.name === "string" ? details.name : "unknown",
    });
    return {
      ok: false,
      error:
        details.code === "P2002"
          ? "Não foi possível criar a conta com os dados informados."
          : "Não foi possível criar o estabelecimento agora. Tente novamente em instantes.",
    };
  }

  await notifyPlatformAdminOfSignup({
    salonName: data.salonName,
    slug,
    ownerName: data.ownerName,
    ownerEmail: email,
  });

  return { ok: true, slug };
}
