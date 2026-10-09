"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { passwordRecoveryEmailEnabled } from "@/lib/password-recovery-feature";
import { supabaseAuthEnabled, recoveryRedirect } from "@/lib/supabase-auth-config";
import { createAuthClient } from "@/lib/supabase-auth";
import { withSalonBySlug } from "@/lib/prisma-tenant";

const schema = z.object({
  salonSlug: z.string().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  email: z.string().trim().toLowerCase().email().max(254),
});
const message = "Se houver um cadastro aguardando confirmação, você receberá um novo link. Confira também o spam e aguarde um minuto antes de tentar novamente.";

export async function resendClientConfirmation(salonSlug: string, email: string) {
  const parsed = schema.safeParse({ salonSlug, email });
  if (!parsed.success) return { error: "Informe um e-mail válido." };
  if (!supabaseAuthEnabled() || !passwordRecoveryEmailEnabled()) {
    return { error: "Confirmação por e-mail indisponível agora. Tente mais tarde." };
  }
  const ip = clientIp(await headers());
  const [ipLimit, accountLimit] = await Promise.all([
    checkRateLimit({ namespace: "client-confirm-ip", identifier: ip, limit: 5, windowSeconds: 3600, failClosed: true }),
    // Global per email: rotating salons cannot bypass the provider's cooldown.
    checkRateLimit({ namespace: "client-confirm-account", identifier: parsed.data.email, limit: 1, windowSeconds: 60, failClosed: true }),
  ]);
  if (ipLimit.source === "unavailable" || accountLimit.source === "unavailable") {
    return { error: "Serviço de segurança temporariamente indisponível." };
  }
  if (!ipLimit.allowed) return { error: "Muitas tentativas. Aguarde antes de solicitar outro e-mail." };
  if (!accountLimit.allowed) return { message };
  try {
    const profile = await withSalonBySlug(parsed.data.salonSlug, (tx, salonId) => tx.clientProfile.findFirst({
      where: { salonId, email: { equals: parsed.data.email, mode: "insensitive" }, authIdentityId: { not: null }, mergedIntoId: null },
      select: { id: true },
    }));
    if (profile) {
      const { error } = await createAuthClient().auth.resend({ type: "signup", email: parsed.data.email,
        options: { emailRedirectTo: recoveryRedirect(parsed.data.salonSlug).replace("redefinir-senha", "login") } });
      if (error) console.warn("auth_confirmation_resend_failed", { category: "provider" });
    }
  } catch { console.warn("auth_confirmation_resend_failed", { category: "unavailable" }); }
  // Same response for unknown, confirmed, unconfirmed and provider errors.
  // No credential/profile mutations, and no claim of actual delivery.
  return { message };
}
