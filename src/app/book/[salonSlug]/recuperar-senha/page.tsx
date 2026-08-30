import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PasswordRecoveryRequestForm } from "@/components/password-recovery-request-form";
import { passwordRecoveryEmailEnabled } from "@/lib/password-recovery-feature";
import { withSalonBySlug } from "@/lib/prisma-tenant";

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
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">{salon.name}</p>
          <h1 className="mt-1 text-2xl font-semibold">Recuperar senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informe o e-mail da sua conta. A resposta não confirma se o cadastro existe.
          </p>
        </div>
        <PasswordRecoveryRequestForm
          salonSlug={salonSlug}
          enabled={passwordRecoveryEmailEnabled()}
        />
        <div className="text-center">
          <Link href={`/book/${salonSlug}/login`} className="text-xs text-muted-foreground hover:text-foreground">
            ← Voltar para entrar
          </Link>
        </div>
      </div>
    </main>
  );
}
