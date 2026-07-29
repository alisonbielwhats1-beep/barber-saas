"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { consumeUserInvite } from "@/lib/invitations";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const inputSchema = z.object({
  token: z.string().min(20).max(256),
});

export async function acceptInvite(input: {
  token: string;
}): Promise<{ error: string }> {
  const limited = await checkRateLimit({
    namespace: "accept-invite",
    identifier: clientIp(headers()),
    limit: 8,
    windowSeconds: 15 * 60,
  });
  if (!limited.allowed) {
    return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Link inválido, expirado ou já utilizado." };
  }

  const session = await getServerSession(authOptions);
  const result = await consumeUserInvite(parsed.data.token, {
    actorUserId: session?.user?.id ?? null,
  });
  if (!result.ok) {
    // Mensagem única: não revela se o token existiu, expirou ou já foi usado.
    return { error: "Link inválido, expirado ou já utilizado." };
  }

  redirect("/dashboard");
}
