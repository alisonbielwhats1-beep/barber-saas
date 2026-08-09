import Link from "next/link";
import { SignupForm } from "./signup-form";
import { AuthShell } from "@/components/auth-shell";

export default function SignupPage() {
  return (
    <AuthShell
      title="Criar estabelecimento"
      description="Preencha os dados para solicitar acesso. Depois da análise, você recebe o plano Grátis ou Pro escolhido pelo administrador."
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
