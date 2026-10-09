import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { createAuthClient } from "@/lib/supabase-auth";
import { confirmationLoginDestination, isProviderTokenHash } from "@/lib/supabase-auth-config";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { headers } from "next/headers";
import Link from "next/link";

export const metadata: Metadata = { title: "Confirmar e-mail | Everflair", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ConfirmEmail({ searchParams }: { searchParams: Promise<{ token_hash?: string; next?: string; error?: string }> }) {
  const query = await searchParams;
  const destination = confirmationLoginDestination(query.next);
  const invalidPath = `/auth/confirm?error=invalid&next=${encodeURIComponent(destination)}`;
  async function confirm() {
    "use server";
    const limited = await checkRateLimit({ namespace: "auth-confirm-ip", identifier: clientIp(await headers()), limit: 10, windowSeconds: 3600, failClosed: true });
    if (!limited.allowed || !isProviderTokenHash(query.token_hash)) redirect(invalidPath);
    try {
      const client = createAuthClient();
      const { error } = await client.auth.verifyOtp({ token_hash: query.token_hash!, type: "signup" });
      if (error) throw new Error("INVALID");
      await client.auth.signOut({ scope: "local" });
    } catch { redirect(invalidPath); }
    redirect(destination);
  }
  return <AuthShell footer={<Link href={destination}>Voltar para o login</Link>} title="Confirmar e-mail" description={query.error ? "Este link é inválido, expirou ou já foi utilizado. Se você já confirmou o e-mail, entre com sua senha. Caso contrário, volte ao login para solicitar outro link." : "Confirme seu e-mail para entrar com segurança."}>
    {!query.error && <form action={confirm}><Button className="w-full" size="lg" type="submit">Confirmar meu e-mail</Button></form>}
  </AuthShell>;
}
