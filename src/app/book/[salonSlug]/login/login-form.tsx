"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { loginClient } from "../auth-actions";

export function LoginForm({
  salonSlug,
  passwordReset = false,
}: {
  salonSlug: string;
  passwordReset?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const result = await loginClient(salonSlug, email, password);
        if (result?.error) setError(result.error);
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {passwordReset && (
        <p role="status" className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-[13px] text-emerald-700 dark:text-emerald-300">
          Senha alterada. Entre novamente.
        </p>
      )}
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
          E-mail
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="seu@email.com"
          className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      <PasswordInput
        id="client-password"
        name="password"
        label="Senha"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        autoComplete="current-password"
        placeholder="••••••••"
        className="h-auto rounded-2xl border-border bg-card px-4 py-3 focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
        labelClassName="text-[13px] text-muted-foreground"
      />

      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-2.5 text-[13px] text-red-500">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
