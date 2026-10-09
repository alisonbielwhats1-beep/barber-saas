"use client";

import { useRef, useState } from "react";
import { resendClientConfirmation } from "@/app/book/[salonSlug]/confirmation-actions";

export function ClientConfirmationHelp({ salonSlug, email }: { salonSlug: string; email: string }) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<{ email: string; message: string; error: boolean } | null>(null);
  const normalizedEmail = email.trim().toLowerCase();
  async function resend() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const result = await resendClientConfirmation(salonSlug, email);
      setFeedback({ email: normalizedEmail, message: result.error ?? result.message!, error: !!result.error });
    } catch {
      setFeedback({ email: normalizedEmail, message: "Não foi possível solicitar o e-mail. Verifique sua conexão e tente novamente.", error: true });
    } finally { busy.current = false; setPending(false); }
  }
  return <div className="space-y-2 text-sm text-muted-foreground">
    <p>Acabou de criar sua conta? Confirme seu e-mail pelo link recebido antes de entrar. Você pode manter a mesma senha.</p>
    <button type="button" disabled={pending || !email.trim()} onClick={() => void resend()}
      className="min-h-11 text-primary underline underline-offset-2 disabled:opacity-60">
      {pending ? "Solicitando…" : "Reenviar confirmação de e-mail"}
    </button>
    {feedback?.email === normalizedEmail && <p role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
  </div>;
}
