"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { normalizePhone } from "@/lib/phone";
import { setClientSession, clearClientSession } from "@/lib/client-auth";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/** Só aceita caminhos internos do próprio salão — evita open redirect. */
function safeReturnTo(salonSlug: string, returnTo?: string | null): string {
  if (returnTo && returnTo.startsWith(`/book/${salonSlug}/`)) return returnTo;
  return `/book/${salonSlug}/minhas`;
}

export async function loginClient(
  salonSlug: string,
  email: string,
  password: string,
  returnTo?: string | null,
): Promise<{ error: string }> {
  const normalizedEmail = email.toLowerCase().trim();
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const [ipLimit, accountLimit] = await Promise.all([
    checkRateLimit({
      namespace: "client-login-ip",
      identifier: `${ip}:${salonSlug}`,
      limit: 30,
      windowSeconds: 15 * 60,
      failClosed: true,
    }),
    checkRateLimit({
      namespace: "client-login-account",
      identifier: `${salonSlug}:${normalizedEmail}`,
      limit: 8,
      windowSeconds: 15 * 60,
      failClosed: true,
    }),
  ]);
  if (!ipLimit.allowed || !accountLimit.allowed) {
    if (
      ipLimit.source === "unavailable" ||
      accountLimit.source === "unavailable"
    ) {
      return { error: "Serviço de segurança temporariamente indisponível." };
    }
    return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  const found = await withSalonBySlug(salonSlug, (tx, salonId) =>
    tx.clientProfile.findFirst({
      where: { salonId, email: normalizedEmail },
      select: { id: true, name: true, email: true, passwordHash: true },
    }).then((client) => ({ salonId, client })),
  );
  if (!found) return { error: "Salão não encontrado" };
  const { salonId, client } = found;

  if (!client?.passwordHash) return { error: "E-mail ou senha incorretos" };

  const valid = await bcrypt.compare(password, client.passwordHash);
  if (!valid) return { error: "E-mail ou senha incorretos" };

  await setClientSession({
    clientId: client.id,
    salonId,
    name: client.name,
    email: client.email!,
  });

  redirect(safeReturnTo(salonSlug, returnTo));
}

export async function registerClient(
  salonSlug: string,
  data: { name: string; phone: string; email: string; password: string },
  returnTo?: string | null,
): Promise<{ error: string }> {
  const requestHeaders = await headers();
  const limited = await checkRateLimit({
    namespace: "client-register",
    identifier: `${clientIp(requestHeaders)}:${salonSlug}`,
    limit: 5,
    windowSeconds: 60 * 60,
    failClosed: true,
  });
  if (!limited.allowed) {
    if (limited.source === "unavailable") {
      return { error: "Serviço de segurança temporariamente indisponível." };
    }
    return { error: "Muitas tentativas. Aguarde antes de criar outra conta." };
  }

  const email = data.email.toLowerCase().trim();
  // Hash fora da transação: bcrypt é CPU-bound e não depende de nada lido do
  // banco — não faz sentido segurar a conexão presa nesse tempo.
  const passwordHash = await bcrypt.hash(data.password, 10);

  const result = await withSalonBySlug(salonSlug, async (tx, salonId) => {
    const exists = await tx.clientProfile.findFirst({
      where: { salonId, email },
      select: { id: true },
    });
    if (exists) return { error: "duplicate" as const };

    const client = await tx.clientProfile.create({
      data: {
        salonId,
        name: data.name.trim(),
        phone: normalizePhone(data.phone) || null,
        email,
        passwordHash,
      },
      select: { id: true },
    });
    return { clientId: client.id, salonId };
  });
  if (!result) return { error: "Salão não encontrado" };
  if ("error" in result) {
    return { error: "Não foi possível criar a conta com os dados informados." };
  }

  await setClientSession({
    clientId: result.clientId,
    salonId: result.salonId,
    name: data.name.trim(),
    email,
  });

  redirect(safeReturnTo(salonSlug, returnTo));
}

export async function logoutClient(salonSlug: string): Promise<void> {
  await clearClientSession();
  redirect(`/book/${salonSlug}`);
}
