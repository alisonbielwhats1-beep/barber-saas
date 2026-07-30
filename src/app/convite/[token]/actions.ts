"use server";

import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import {
  EMAIL_INVITES_DISABLED_MESSAGE,
  emailInvitesEnabled,
} from "@/lib/email-invites-feature";
import {
  acceptExistingUserInvite,
  acceptNewUserInvite,
} from "@/lib/invitations";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const inputSchema = z
  .object({
    token: z.string().min(20).max(256),
    mode: z.enum(["new", "existing"]),
    password: z.string().optional(),
    confirmPassword: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.mode !== "new") return;
    if (!input.password || input.password.length < 10) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "A senha precisa ter pelo menos 10 caracteres.",
      });
    }
    if (input.password !== input.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "As senhas não coincidem.",
      });
    }
  });

function messageFor(reason: string): string {
  const messages: Record<string, string> = {
    INVALID: "Convite inválido.",
    EXPIRED: "Este convite expirou. Solicite um novo envio.",
    USED: "Este convite já foi utilizado.",
    REVOKED: "Este convite foi cancelado.",
    WRONG_USER: "Este convite pertence a outra conta.",
    CONFLICT:
      "Não foi possível concluir agora. O convite não foi consumido; tente novamente.",
  };
  return messages[reason] ?? "Falha temporária. Tente novamente.";
}

export async function acceptInvite(input: {
  token: string;
  mode: "new" | "existing";
  password?: string;
  confirmPassword?: string;
}): Promise<
  | { ok: true; newAccount: boolean; email?: string }
  | { ok: false; error: string }
> {
  if (!emailInvitesEnabled()) {
    return { ok: false, error: EMAIL_INVITES_DISABLED_MESSAGE };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const [ipLimit, tokenLimit] = await Promise.all([
    checkRateLimit({
      namespace: "accept-invite-ip",
      identifier: ip,
      limit: 20,
      windowSeconds: 15 * 60,
      failClosed: true,
    }),
    checkRateLimit({
      namespace: "accept-invite-token",
      identifier: parsed.data.token,
      limit: 8,
      windowSeconds: 15 * 60,
      failClosed: true,
    }),
  ]);
  if (!ipLimit.allowed || !tokenLimit.allowed) {
    if (
      ipLimit.source === "unavailable" ||
      tokenLimit.source === "unavailable"
    ) {
      return {
        ok: false,
        error: "Serviço de segurança temporariamente indisponível. Tente novamente.",
      };
    }
    return {
      ok: false,
      error: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    };
  }

  if (parsed.data.mode === "new") {
    const result = await acceptNewUserInvite({
      token: parsed.data.token,
      password: parsed.data.password!,
    });
    if (!result.ok) return { ok: false, error: messageFor(result.reason) };
    return { ok: true, newAccount: true, email: result.email };
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: "Entre na conta convidada para continuar." };
  }
  const result = await acceptExistingUserInvite({
    token: parsed.data.token,
    actorUserId: session.user.id,
  });
  if (!result.ok) return { ok: false, error: messageFor(result.reason) };
  return { ok: true, newAccount: false };
}
