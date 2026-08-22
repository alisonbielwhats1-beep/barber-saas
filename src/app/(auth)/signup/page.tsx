import Link from "next/link";
import { SignupForm } from "./signup-form";
import { AuthShell } from "@/components/auth-shell";

export default function SignupPage() {
  return (
    <AuthShell
      title="Criar estabelecimento"
      description="Crie seu espaço no plano Grátis e entre imediatamente. Um futuro upgrade para o Pro passa pela análise do administrador."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" className="text-primary transition hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
