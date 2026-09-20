"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  requestAdminPasswordReset,
  requestClientPasswordReset,
} from "@/app/password-recovery-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordRecoveryRequestForm({
  salonSlug,
  enabled,
}: {
  salonSlug?: string;
  enabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || pending) return;
    setPending(true);
    setMessage(null);
    setFailed(false);
    const form = new FormData(event.currentTarget);
    try {
      const email = String(form.get("email") ?? "");
      const result = salonSlug
        ? await requestClientPasswordReset(salonSlug, email)
        : await requestAdminPasswordReset(email);
      setMessage(result.message);
      setFailed(!result.ok);
    } catch {
      setFailed(true);
      setMessage("Não foi possível solicitar o e-mail agora. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  if (!enabled) {
    return (
      <p role="status" className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">
        A recuperação por e-mail está temporariamente indisponível. Fale com o suporte.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="recovery-email" className="text-sm font-medium">E-mail</label>
        <Input
          id="recovery-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          disabled={pending}
          autoCapitalize="none"
          className="h-11"
          required
        />
      </div>
      <div className="min-h-16" aria-live="polite" aria-atomic="true">
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "text-sm text-destructive" : "text-sm text-foreground"}>
          {message}
        </p>
      )}
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {pending ? "Enviando…" : "Enviar link de recuperação"}
      </Button>
    </form>
  );
}
