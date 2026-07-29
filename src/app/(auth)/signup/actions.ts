"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { uniqueSalonSlug } from "@/lib/slug";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const signupInput = z.object({
  ownerName: z.string().min(2, "Nome muito curto"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha precisa ter ao menos 6 caracteres"),
  salonName: z.string().min(2, "Nome do salão muito curto"),
});

export type SignupInput = z.infer<typeof signupInput>;

/**
 * Cria conta do dono + salão + membership OWNER + horário padrão (seg-sáb 09-19)
 * em uma transação. Retorna `{ slug }` para o client redirecionar corretamente.
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
  });
  if (!limited.allowed) {
    return { ok: false, error: "Muitas tentativas. Aguarde e tente novamente." };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "Não foi possível criar a conta com os dados informados." };
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const passwordSetAt = new Date();
  const slug = await uniqueSalonSlug(data.salonName);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name: data.ownerName, passwordHash, passwordSetAt },
      select: { id: true },
    });
    const salon = await tx.salon.create({
      data: { slug, name: data.salonName, plan: "FREE" },
      select: { id: true },
    });
    await tx.membership.create({
      data: { userId: user.id, salonId: salon.id, role: "OWNER" },
    });
  });

  return { ok: true, slug };
}
