import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { ProductWordmark } from "@/components/product-wordmark";
import { AuthShowcase } from "../auth-showcase";

export default function LoginPage() {
  return (
    <main data-business-experience="espaco-misto" data-experience-direction="modular" data-experience-density="comfortable" className="experience-scope grid min-h-dvh bg-background lg:grid-cols-[1.1fr_0.9fr]">
      <AuthShowcase mode="login" />

      <section className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10 sm:px-8">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--experience-accent)/0.12),transparent_32rem)]" />
        <div className="relative z-10 w-full max-w-[430px]">
          <ProductWordmark className="mb-10" />

          <div className="experience-surface-raised p-6 sm:p-8">
            <div className="mb-7">
              <p className="experience-eyebrow text-[10px] font-semibold uppercase tracking-[0.17em]">Acesso ao workspace</p>
              <h1 className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.04em]">Bem-vindo de volta</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Entre para acessar a operação do seu estabelecimento.</p>
            </div>

            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>

            <p className="mt-6 text-center text-[12px] text-muted-foreground">
              Ainda não tem estabelecimento?{" "}
              <Link href="/signup" className="font-semibold text-primary transition hover:underline">
                Criar conta
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
