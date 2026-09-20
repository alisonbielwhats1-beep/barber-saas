import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PasswordResetForm } from "@/components/password-reset-form";
import { ClientAccessLayout } from "../client-access-layout";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { hasRecoverySession } from "@/lib/supabase-recovery";
import { supabaseAuthEnabled, isProviderTokenHash } from "@/lib/supabase-auth-config";

export const metadata: Metadata = { title: "Criar nova senha | Everflair", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ResetPasswordPage({ params, searchParams }: {
  params: Promise<{ salonSlug: string }>;
  searchParams: Promise<{ token_hash?: string; type?: string; error?: string }>;
}) {
  const [{ salonSlug }, query] = await Promise.all([params, searchParams]);
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) => tx.salon.findUnique({ where: { id: salonId }, select: { name: true } }));
  if (!salon) notFound();
  const token = query.type === "recovery" && isProviderTokenHash(query.token_hash) ? query.token_hash : "";
  const ready = supabaseAuthEnabled() && !query.error && (!!token || await hasRecoverySession(salonSlug));
  return <ClientAccessLayout salonName={salon.name} eyebrow="Sua conta" title="Criar nova senha" description="Defina sua nova senha para voltar a acessar sua conta.">
    <PasswordResetForm token={token} salonSlug={salonSlug} provider ready={!!ready} />
    <Link href={`/book/${salonSlug}/login`} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary underline">Voltar para o login</Link>
  </ClientAccessLayout>;
}
