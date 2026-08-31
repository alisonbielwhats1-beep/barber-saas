import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/auth-shell";
import { PasswordRecoveryLoginLink } from "@/components/password-recovery-login-link";

export default function LoginPage() {
  return (
    <AuthShell
      title="Bem-vindo de volta"
      description="Entre para acompanhar sua agenda, equipe e resultados."
      footer={
        <>
          Ainda não tem estabelecimento?{" "}
          <Link href="/signup" className="text-primary transition hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <PasswordRecoveryLoginLink
        href="/recuperar-senha"
        className="mt-4 text-center text-[12px] text-foreground/70"
      />
    </AuthShell>
  );
}
