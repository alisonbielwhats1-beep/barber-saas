"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { resetAdminPassword, resetClientPassword } from "@/app/password-recovery-actions";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import Link from "next/link";
import { newAuthPasswordSchema, NEW_PASSWORD_HELP } from "@/lib/recovery-validation";

export function PasswordResetForm({
  token,
  salonSlug,
  provider = false,
  ready = true,
}: {
  token: string;
  salonSlug?: string;
  provider?: boolean;
  ready?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
    if (provider) {
      const valid = newAuthPasswordSchema.safeParse(input.password);
      if (!valid.success || input.password !== input.confirmPassword) {
        setError(!valid.success ? valid.error.issues[0].message : "As senhas não coincidem.");
        setPending(false);
        return;
      }
    }
    try {
      const result = salonSlug
        ? await resetClientPassword(salonSlug, input)
        : await resetAdminPassword(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      router.replace(salonSlug ? `/book/${salonSlug}/login?senha=alterada` : "/login?senha=alterada");
      router.refresh();
    } catch {
      setError("Não foi possível alterar a senha agora. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  if (!ready) return <div className="space-y-4">
    <p role="alert" className="text-sm text-destructive">Este link é inválido, expirou ou já foi utilizado. Solicite um novo e-mail.</p>
    <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline" href={salonSlug ? `/book/${salonSlug}/recuperar-senha` : "/recuperar-senha"}>Solicitar outro link</Link>
  </div>;

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      <fieldset disabled={pending || success} className="min-w-0 space-y-4">
      <PasswordInput
        id="new-password"
        name="password"
        label="Nova senha"
        autoComplete="new-password"
        minLength={provider ? 10 : 6}
        maxLength={72}
        className="h-11"
        aria-describedby="password-help password-feedback"
        aria-invalid={!!error}
        required
      />
      <PasswordInput
        id="confirm-new-password"
        name="confirmPassword"
        label="Confirmar nova senha"
        autoComplete="new-password"
        minLength={provider ? 10 : 6}
        maxLength={72}
        className="h-11"
        aria-describedby="password-feedback"
        aria-invalid={!!error}
        required
      />
      <p id="password-help" className="text-xs text-muted-foreground">
        {provider ? NEW_PASSWORD_HELP : "Use pelo menos 6 caracteres. O link deixa de funcionar após a alteração."}
      </p>
      <div id="password-feedback" className="min-h-12" aria-live="polite" aria-atomic="true">
      {success && <p role="status" className="text-sm text-success">Senha atualizada com sucesso.</p>}
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {pending ? "Atualizando…" : "Atualizar senha"}
      </Button>
      </fieldset>
    </form>
  );
}
