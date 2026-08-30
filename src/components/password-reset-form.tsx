"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { resetAdminPassword, resetClientPassword } from "@/app/password-recovery-actions";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

export function PasswordResetForm({
  token,
  salonSlug,
}: {
  token: string;
  salonSlug?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const input = {
      token,
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    };
    try {
      const result = salonSlug
        ? await resetClientPassword(salonSlug, input)
        : await resetAdminPassword(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace(salonSlug ? `/book/${salonSlug}/login?senha=alterada` : "/login?senha=alterada");
      router.refresh();
    } catch {
      setError("Não foi possível alterar a senha agora. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PasswordInput
        id="new-password"
        name="password"
        label="Nova senha"
        autoComplete="new-password"
        minLength={6}
        required
      />
      <PasswordInput
        id="confirm-new-password"
        name="confirmPassword"
        label="Confirmar nova senha"
        autoComplete="new-password"
        minLength={6}
        required
      />
      <p className="text-xs text-muted-foreground">
        Use pelo menos 6 caracteres. O link deixa de funcionar após a alteração.
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {pending ? "Alterando…" : "Alterar senha"}
      </Button>
    </form>
  );
}
