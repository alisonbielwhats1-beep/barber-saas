"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { formatPhoneBR, isValidPhoneBR } from "@/lib/phone";
import { registerClient } from "../auth-actions";

export function CadastroForm({
  salonSlug,
  returnTo,
}: {
  salonSlug: string;
  returnTo?: string | null;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres");
      return;
    }
    if (phone && !isValidPhoneBR(phone)) {
      setError("WhatsApp inválido — use DDD + número, ex.: (11) 91234-5678");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await registerClient(salonSlug, { name, phone, email, password }, returnTo);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
          Nome completo
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
          placeholder="Seu nome"
          className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
          WhatsApp{" "}
          <span className="font-normal text-muted-foreground/60">(opcional)</span>
        </label>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(formatPhoneBR(e.target.value))}
          autoComplete="tel"
          placeholder="(11) 91234-5678"
          className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

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

      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
          Senha
        </label>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder="Mínimo 6 caracteres"
            className="w-full rounded-2xl border border-border bg-card px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            tabIndex={-1}
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

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
        {pending ? "Criando conta…" : "Criar conta"}
      </button>
    </form>
  );
}
