"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptInvite } from "./actions";

export function InviteForm({
  token,
  mode,
}: {
  token: string;
  mode: "new" | "existing";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = mode === "new" ? String(form.get("password") ?? "") : undefined;
    const confirmPassword =
      mode === "new" ? String(form.get("confirmPassword") ?? "") : undefined;

    startTransition(async () => {
      const result = await acceptInvite({
        token,
        mode,
        password,
        confirmPassword,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      if (result.newAccount && result.email && password) {
        const signedIn = await signIn("credentials", {
          email: result.email,
          password,
          callbackUrl: "/dashboard",
          redirect: false,
        });
        if (signedIn?.ok) {
          window.location.assign(signedIn.url ?? "/dashboard");
          return;
        }
        window.location.assign("/login?callbackUrl=%2Fdashboard");
        return;
      }
      window.location.assign("/dashboard");
    });
  }

  if (success) {
    return (
      <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
        Convite aceito. Preparando seu painel…
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "new" && (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium">Senha</label>
            <Input
              name="password"
              type="password"
              minLength={10}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Confirmar senha
            </label>
            <Input
              name="confirmPassword"
              type="password"
              minLength={10}
              autoComplete="new-password"
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Use pelo menos 10 caracteres. Evite senhas reutilizadas em outros
            serviços.
          </p>
        </>
      )}
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending
          ? "Confirmando…"
          : mode === "new"
            ? "Criar conta e aceitar convite"
            : "Aceitar convite"}
      </Button>
    </form>
  );
}
