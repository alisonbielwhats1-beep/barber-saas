import type { Metadata } from "next";
import Link from "next/link";
import { Mail, ShieldCheck, LifeBuoy } from "lucide-react";
import { LegalSection, LegalShell } from "../legal-shell";
import { PRIVACY_CONTACT_EMAIL, SERVICE_NAME } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Contato — ${SERVICE_NAME}`,
  description:
    "Como falar com o SalonSaaS: suporte, pedidos de LGPD e assuntos contratuais.",
};

/**
 * Página de contato deliberadamente sem formulário: um formulário exigiria
 * armazenar ou repassar a mensagem a um serviço de envio — mais dado pessoal
 * coletado, mais um subprocessador a declarar na política. Um endereço de
 * e-mail resolve o mesmo problema sem nada disso.
 */
export default function ContatoPage() {
  return (
    <LegalShell
      title="Contato"
      intro="Um endereço só, para todos os assuntos. Respondemos em até 15 dias — normalmente bem antes disso."
    >
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Mail className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              E-mail
            </p>
            <a
              href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              className="block truncate text-lg text-foreground underline underline-offset-4"
            >
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </div>

      <LegalSection title="O que escrever conforme o assunto">
        <div className="space-y-4">
          <ContactTopic
            icon={<LifeBuoy className="h-4 w-4 text-primary" />}
            title="Suporte e problemas no sistema"
            body="Descreva o que tentou fazer, o que aconteceu e em qual tela. Se puder, anexe uma captura — encurta muito o diagnóstico."
          />
          <ContactTopic
            icon={<ShieldCheck className="h-4 w-4 text-primary" />}
            title="Privacidade e dados pessoais (LGPD)"
            body="Acesso, correção, portabilidade ou exclusão dos seus dados. Escreva “LGPD” no assunto. Podemos pedir informação adicional para confirmar sua identidade antes de liberar ou apagar qualquer dado — é o que impede que outra pessoa faça esse pedido no seu lugar."
          />
        </div>
      </LegalSection>

      <LegalSection title="Se você é cliente de um estabelecimento">
        <p>
          Para remarcar, cancelar ou tirar dúvida sobre um atendimento, fale
          diretamente com o estabelecimento — é ele quem administra a própria agenda,
          e nós não temos acesso para alterar atendimentos em nome dele.
        </p>
        <p>
          Para pedidos sobre seus dados pessoais, procure também primeiro o
          estabelecimento, que é o controlador. Se não obtiver resposta, escreva para
          nós que ajudamos a direcionar. O motivo dessa ordem está explicado na{" "}
          <Link
            href="/privacidade"
            className="text-foreground underline underline-offset-4"
          >
            Política de Privacidade
          </Link>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}

function ContactTopic({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-surface-1 p-4">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
