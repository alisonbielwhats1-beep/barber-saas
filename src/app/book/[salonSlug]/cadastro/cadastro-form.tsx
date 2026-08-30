"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { formatPhoneBR, isValidPhoneBR } from "@/lib/phone";
import { registerClient } from "../auth-actions";

export function CadastroForm({
  salonSlug,
}: {
  salonSlug: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (phone && !isValidPhoneBR(phone)) {
      setError("WhatsApp inválido — use DDD + número, ex.: (11) 91234-5678");
      return;
    }
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const result = await registerClient(
          salonSlug,
          { name, phone, email, password, confirmPassword },
        );
        if (result?.error) setError(result.error);
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="client-name" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
          Nome completo
        </label>
        <input
          id="client-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          placeholder="Seu nome"
          className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label htmlFor="client-phone" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
          WhatsApp{" "}
          <span className="font-normal text-muted-foreground/60">(opcional)</span>
        </label>
        <input
          id="client-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(formatPhoneBR(e.target.value))}
          maxLength={32}
          autoComplete="tel"
          placeholder="(11) 91234-5678"
          className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label htmlFor="client-email" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
          E-mail
        </label>
        <input
          id="client-email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
          autoComplete="email"
          placeholder="seu@email.com"
          className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <PasswordInput
        id="client-new-password"
        name="password"
        label="Senha"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        minLength={6}
        maxLength={72}
        autoComplete="new-password"
        placeholder="Mínimo 6 caracteres"
        className="h-auto rounded-2xl border-border bg-card px-4 py-3 focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
        labelClassName="text-[13px] text-muted-foreground"
      />
      <PasswordInput
        id="client-confirm-password"
        name="confirmPassword"
        label="Confirmar senha"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        required
        minLength={6}
        maxLength={72}
        autoComplete="new-password"
        placeholder="Digite a senha novamente"
        className="h-auto rounded-2xl border-border bg-card px-4 py-3 focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
        labelClassName="text-[13px] text-muted-foreground"
      />

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-2.5 text-[13px] text-red-500">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Criando conta…" : "Criar conta"}
      </button>
    </form>
  );
}
