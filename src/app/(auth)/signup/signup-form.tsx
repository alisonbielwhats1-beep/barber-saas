"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  SegmentPicker,
  StarterServicePicker,
  useSegmentSelection,
} from "@/components/segment-service-picker";
import { signup } from "./actions";

export function SignupForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selection = useSegmentSelection();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      ownerName: String(form.get("ownerName")),
      email: String(form.get("email")),
      password: String(form.get("password")),
      confirmPassword: String(form.get("confirmPassword")),
      salonName: String(form.get("salonName")),
      segmentId: selection.segmentId,
      serviceNames: selection.serviceNames,
    };
    if (payload.password !== payload.confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await signup(payload);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // Auto-login logo após criar.
        const signInRes = await signIn("credentials", {
          email: payload.email,
          password: payload.password,
          redirect: false,
        });
        if (signInRes?.error) {
          setError("Conta criada, mas não foi possível entrar automaticamente. Use o login.");
          return;
        }
        router.push("/onboarding/acesso");
        router.refresh();
      } catch {
        setError("Não foi possível concluir agora. Verifique sua conexão e tente novamente.");
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <label htmlFor="salonName" className="text-sm font-medium">Nome do salão</label>
        <Input id="salonName" name="salonName" placeholder="Luna Hair Studio" required autoFocus />
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Tipo de negócio</p>
        <p className="text-xs text-muted-foreground">
          Define a aparência da sua página pública e sugere seus serviços. Você
          cadastra qualquer serviço depois, independente do que escolher aqui.
        </p>
        <div className="pt-1">
          <SegmentPicker segmentId={selection.segmentId} onPick={selection.pickSegment} />
        </div>
      </div>

      <StarterServicePicker
        segment={selection.segment}
        isChecked={selection.isChecked}
        onToggle={selection.toggleService}
        collapsible
      />
      <div className="space-y-1.5">
        <label htmlFor="ownerName" className="text-sm font-medium">Seu nome</label>
        <Input id="ownerName" name="ownerName" placeholder="Marina Souza" required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <Input id="email" name="email" type="email" placeholder="voce@salon.com" required />
      </div>
      <PasswordInput
        id="password"
        name="password"
        label="Senha"
        minLength={6}
        autoComplete="new-password"
        required
      />
      <PasswordInput
        id="confirmPassword"
        name="confirmPassword"
        label="Confirmar senha"
        minLength={6}
        autoComplete="new-password"
        required
      />
      <p className="text-xs text-muted-foreground">Mínimo 6 caracteres.</p>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Enviando solicitação…" : "Solicitar acesso"}
      </Button>
    </form>
  );
}
