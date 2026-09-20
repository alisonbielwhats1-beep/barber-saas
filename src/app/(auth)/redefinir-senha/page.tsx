import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { PasswordResetForm } from "@/components/password-reset-form";
import { hasRecoverySession } from "@/lib/supabase-recovery";
import { supabaseAuthEnabled, isProviderTokenHash } from "@/lib/supabase-auth-config";

export const metadata: Metadata = { title: "Criar nova senha | Everflair", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; error?: string }> }) {
  const query = await searchParams;
  const enabled = supabaseAuthEnabled();
  const token = query.type === "recovery" && isProviderTokenHash(query.token_hash) ? query.token_hash : "";
  const ready = enabled && !query.error && (!!token || await hasRecoverySession());
  return <AuthShell title="Criar nova senha" description="Defina sua nova senha para voltar a acessar sua conta."
    footer={<Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline">Voltar para o login</Link>}>
    <PasswordResetForm token={token} provider ready={!!ready} />
  </AuthShell>;
}
