"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signup } from "./actions";

export function SignupForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      ownerName: String(form.get("ownerName")),
      email: String(form.get("email")),
      password: String(form.get("password")),
      salonName: String(form.get("salonName")),
    };

    startTransition(async () => {
      const res = await signup(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Auto-login logo após criar
      const signInRes = await signIn("credentials", {
        email: payload.email,
        password: payload.password,
        redirect: false,
      });
      if (signInRes?.error) {
        setError("Conta criada, mas falhou ao entrar. Vá para o login.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <label htmlFor="salonName" className="text-sm font-medium">Nome do salão</label>
        <Input id="salonName" name="salonName" placeholder="Luna Hair Studio" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="ownerName" className="text-sm font-medium">Seu nome</label>
        <Input id="ownerName" name="ownerName" placeholder="Marina Souza" required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <Input id="email" name="email" type="email" placeholder="voce@salon.com" required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">Senha</label>
        <Input id="password" name="password" type="password" minLength={6} required />
        <p className="text-xs text-muted-foreground">Mínimo 6 caracteres.</p>
      </div>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Criando…" : "Criar meu salão"}
      </Button>
    </form>
  );
}
