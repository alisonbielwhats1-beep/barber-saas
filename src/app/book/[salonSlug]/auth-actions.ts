"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
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

  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: { id: true },
  });
  if (!salon) return { error: "Salão não encontrado" };

  const client = await prisma.clientProfile.findFirst({
    where: { salonId: salon.id, email: normalizedEmail },
    select: { id: true, name: true, email: true, passwordHash: true },
  });

  if (!client?.passwordHash) return { error: "E-mail ou senha incorretos" };

  const valid = await bcrypt.compare(password, client.passwordHash);
  if (!valid) return { error: "E-mail ou senha incorretos" };

  await setClientSession({
    clientId: client.id,
    salonId: salon.id,
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

  const salon = await prisma.salon.findUnique({
    where: { slug: salonSlug },
    select: { id: true },
  });
  if (!salon) return { error: "Salão não encontrado" };

  const email = data.email.toLowerCase().trim();

  const exists = await prisma.clientProfile.findFirst({
    where: { salonId: salon.id, email },
    select: { id: true },
  });
  if (exists) {
    return { error: "Não foi possível criar a conta com os dados informados." };
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const client = await prisma.clientProfile.create({
    data: {
      salonId: salon.id,
      name: data.name.trim(),
      phone: normalizePhone(data.phone) || null,
      email,
      passwordHash,
    },
    select: { id: true },
  });

  await setClientSession({
    clientId: client.id,
    salonId: salon.id,
    name: data.name.trim(),
    email,
  });

  redirect(safeReturnTo(salonSlug, returnTo));
}

export async function logoutClient(salonSlug: string): Promise<void> {
  await clearClientSession();
  redirect(`/book/${salonSlug}`);
}
