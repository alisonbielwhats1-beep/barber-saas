import { Suspense } from "react";
import Link from "next/link";
import { Scissors } from "lucide-react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background p-6">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 -z-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, hsl(38 92% 50% / 0.08) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-[360px]">
        {/* Logo */}
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2.5"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary shadow-lg shadow-primary/20">
            <Scissors className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Salon<span className="text-primary">SaaS</span>
          </span>
        </Link>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/40">
          <div className="mb-6">
            <h1 className="text-lg font-semibold tracking-tight">Bem-vindo de volta</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">Entre para acessar seu painel.</p>
          </div>

          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>

          <p className="mt-5 text-center text-[12px] text-muted-foreground">
            Ainda não tem salão?{" "}
            <Link href="/signup" className="text-primary transition hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
