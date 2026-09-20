import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { PasswordRecoveryRequestForm } from "@/components/password-recovery-request-form";
import { passwordRecoveryEmailEnabled } from "@/lib/password-recovery-feature";

export const metadata: Metadata = {
  title: "Recuperar senha | Everflair",
  robots: { index: false, follow: false },
};

export default function RecoverPasswordPage() {
  return (
    <AuthShell
      title="Recuperar senha"
      description="Digite seu e-mail e enviaremos um link para você criar uma nova senha."
      footer={<Link href="/login" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">Voltar para o login</Link>}
    >
      <PasswordRecoveryRequestForm enabled={passwordRecoveryEmailEnabled()} />
    </AuthShell>
  );
}
