import Link from "next/link";
import { redirect } from "next/navigation";
import { getClientSession } from "@/lib/client-auth";
import { CadastroForm } from "./cadastro-form";

export default async function CadastroPage({
  params,
}: {
  params: { salonSlug: string };
}) {
  const session = await getClientSession();
  if (session) redirect(`/book/${params.salonSlug}/minhas`);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
            Sua conta
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Criar conta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Agende sem precisar digitar seus dados toda vez.
          </p>
        </div>

        <CadastroForm salonSlug={params.salonSlug} />

        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link
            href={`/book/${params.salonSlug}/login`}
            className="font-medium text-primary hover:underline"
          >
            Entrar
          </Link>
        </p>

        <div className="text-center">
          <Link
            href={`/book/${params.salonSlug}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Voltar para o salão
          </Link>
        </div>
      </div>
    </main>
  );
}
