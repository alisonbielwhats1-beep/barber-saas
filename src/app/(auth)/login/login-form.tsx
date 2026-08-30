"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { sanitizeAuthCallback } from "@/lib/safe-callback";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = sanitizeAuthCallback(params.get("callbackUrl"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordReset = params.get("senha") === "alterada";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await signIn("credentials", {
        email: form.get("email"),
        password: form.get("password"),
        redirect: false,
      });
      if (res?.error) {
        setError("Email ou senha inválidos.");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Não foi possível entrar agora. Verifique sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form method="post" className="space-y-4" onSubmit={onSubmit} noValidate>
      {passwordReset && (
        <p role="status" className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          Senha alterada. Entre novamente.
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="voce@salon.com"
          className="h-11"
          aria-invalid={!!error}
          aria-describedby={error ? "login-error" : undefined}
          required
        />
      </div>
      <PasswordInput
        id="password"
        name="password"
        label="Senha"
        autoComplete="current-password"
        className="h-11"
        aria-invalid={!!error}
        aria-describedby={error ? "login-error" : undefined}
        required
      />
      {error && (
        <p id="login-error" role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
