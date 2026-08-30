import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { PasswordRecoveryRequestForm } from "@/components/password-recovery-request-form";
import { passwordRecoveryEmailEnabled } from "@/lib/password-recovery-feature";

export const metadata: Metadata = {
  title: "Recuperar senha | SalonSaaS",
  robots: { index: false, follow: false },
};

export default function RecoverPasswordPage() {
  return (
    <AuthShell
      title="Recuperar senha"
      description="Informe o e-mail usado para acessar o painel. Por segurança, a resposta não confirma se a conta existe."
      footer={<Link href="/login" className="font-medium text-primary hover:underline">Voltar para entrar</Link>}
    >
      <PasswordRecoveryRequestForm enabled={passwordRecoveryEmailEnabled()} />
    </AuthShell>
  );
}
