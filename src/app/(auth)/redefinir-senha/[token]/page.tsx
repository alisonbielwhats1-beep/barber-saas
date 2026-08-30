import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { PasswordResetForm } from "@/components/password-reset-form";

export const metadata: Metadata = {
  title: "Criar nova senha | SalonSaaS",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <AuthShell
      title="Criar nova senha"
      description="Defina uma nova senha para o painel. Depois da alteração, entre novamente em seus dispositivos."
      footer={<Link href="/recuperar-senha" className="font-medium text-primary hover:underline">Solicitar outro link</Link>}
    >
      <PasswordResetForm token={token} />
    </AuthShell>
  );
}
