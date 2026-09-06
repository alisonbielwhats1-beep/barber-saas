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
import type { SegmentId } from "@/lib/segments";
import { firstAccessHref, resolvePlanIntent, type MarketingPlanKey } from "@/lib/marketing-plan";
import Link from "next/link";

export function SignupForm({ initialSegment, planIntent }: { initialSegment?: SegmentId; planIntent?: MarketingPlanKey }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selection = useSegmentSelection(initialSegment);
  const [includeServices, setIncludeServices] = useState(false);
  const plan = resolvePlanIntent(planIntent);

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
      serviceNames: includeServices ? selection.serviceNames : [],
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
        router.push(firstAccessHref(planIntent));
        router.refresh();
      } catch {
        setError("Não foi possível concluir agora. Verifique sua conexão e tente novamente.");
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <aside className="es-plan-intent" aria-label="Seu plano de interesse">
        <div><strong>{plan ? `Seu interesse: ${plan.title}` : "Comece no plano Grátis"}</strong>{plan && <span>{plan.price}{plan.plan !== "FREE" && "/mês"} · {plan.professionals}</span>}</div>
        <p>{plan && plan.plan !== "FREE" ? "Sua conta começa grátis. Depois, confirme disponibilidade e upgrade com a plataforma. Nenhuma cobrança é feita neste cadastro." : "1 agenda e 30 agendamentos por mês. Configure seu espaço antes de decidir por um upgrade."}</p>
        <Link href="/#planos">Rever planos</Link>
      </aside>
      <fieldset className="space-y-4"><legend>01 · SEU NEGÓCIO</legend>
      <div className="space-y-1.5">
        <label htmlFor="salonName" className="text-sm font-medium">Nome do estabelecimento</label>
        <Input id="salonName" name="salonName" placeholder="Como se chama seu espaço?" autoComplete="organization" required />
      </div>

      <details className="es-optional">
        <summary>Tipo de negócio: {selection.segment.shortLabel}<span>Alterar</span></summary>
        <div className="pt-3">
          <SegmentPicker segmentId={selection.segmentId} onPick={selection.pickSegment} />
        </div>
      </details>
      <details className="es-optional">
        <summary>Serviços sugeridos<span>Opcional</span></summary>
        <label className="es-service-optin"><input type="checkbox" checked={includeServices} onChange={event => setIncludeServices(event.target.checked)} />Incluir sugestões de serviços no meu espaço</label>
        <p className="text-xs text-muted-foreground">Você também pode criar seu catálogo depois. Sugestões entram sem preço definido.</p>
        {includeServices && <StarterServicePicker
        segment={selection.segment}
        isChecked={selection.isChecked}
        onToggle={selection.toggleService}
      />}
      </details>
      </fieldset>
      <fieldset className="space-y-4"><legend>02 · SEU ACESSO</legend>
      <div className="space-y-1.5">
        <label htmlFor="ownerName" className="text-sm font-medium">Seu nome</label>
        <Input id="ownerName" name="ownerName" placeholder="Seu nome completo" autoComplete="name" required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <Input id="email" name="email" type="email" placeholder="voce@exemplo.com" autoComplete="email" required />
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
      </fieldset>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Criando seu espaço…" : "Criar meu espaço"}
      </Button>
      <p className="es-next-help">Depois de entrar, um guia ajuda a configurar serviços, profissionais e horários.</p>
    </form>
  );
}
