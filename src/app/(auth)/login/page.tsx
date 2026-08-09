import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/auth-shell";

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
    </AuthShell>
  );
}
