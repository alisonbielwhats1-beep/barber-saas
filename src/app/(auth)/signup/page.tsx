import Link from "next/link";
import { SignupForm } from "./signup-form";
import { ProductWordmark } from "@/components/product-wordmark";
import { AuthShowcase } from "../auth-showcase";

export default function SignupPage() {
  return (
    <main data-business-experience="espaco-misto" data-experience-direction="modular" data-experience-density="comfortable" className="experience-scope grid min-h-dvh bg-background lg:grid-cols-[0.82fr_1.18fr]">
      <AuthShowcase mode="signup" />

      <section className="relative min-w-0 px-4 py-8 sm:px-8 lg:px-10 lg:py-10 xl:px-14">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--experience-accent)/0.1),transparent_34rem)]" />
        <div className="relative z-10 mx-auto min-w-0 w-full max-w-3xl">
          <ProductWordmark className="mb-8" />

          <div className="experience-surface-raised min-w-0 p-5 sm:p-8">
            <div className="mb-7">
              <p className="experience-eyebrow text-[10px] font-semibold uppercase tracking-[0.17em]">Seu novo workspace</p>
              <h1 className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.04em] sm:text-[34px]">Criar estabelecimento</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Escolha a experiência, confirme os serviços iniciais e publique sua agenda.
              </p>
            </div>

            <SignupForm />

            <p className="mt-6 text-center text-[12px] text-muted-foreground">
              Já tem conta?{" "}
              <Link href="/login" className="font-semibold text-primary transition hover:underline">
                Entrar
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
