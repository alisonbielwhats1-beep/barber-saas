import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PasswordRecoveryRequestForm } from "@/components/password-recovery-request-form";
import { passwordRecoveryEmailEnabled } from "@/lib/password-recovery-feature";
import { withSalonBySlug } from "@/lib/prisma-tenant";
import { ClientAccessLayout } from "../client-access-layout";

export const metadata: Metadata = {
  title: "Recuperar senha",
  robots: { index: false, follow: false },
};

export default async function ClientRecoverPasswordPage({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) =>
    tx.salon.findUnique({ where: { id: salonId }, select: { name: true } }),
  );
  if (!salon) notFound();

  return (
    <ClientAccessLayout salonName={salon.name} eyebrow="Sua conta" title="Recuperar senha" description="Digite seu e-mail e enviaremos um link para você criar uma nova senha.">
        <PasswordRecoveryRequestForm
          salonSlug={salonSlug}
          enabled={passwordRecoveryEmailEnabled()}
        />
        <div className="text-center">
          <Link href={`/book/${salonSlug}/login`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline">
            Voltar para o login
          </Link>
        </div>
    </ClientAccessLayout>
  );
}
