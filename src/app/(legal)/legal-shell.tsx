import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { MarketingHeader } from "../marketing-header";
import {
  LEGAL_LAST_UPDATED,
  PRIVACY_CONTACT_EMAIL,
  SERVICE_NAME,
  hasPendingLegalIdentity,
} from "@/lib/legal";

/**
 * Moldura comum de Termos, Privacidade e Contato.
 *
 * Os três documentos precisam parecer o mesmo documento — cabeçalho, largura de
 * leitura e escala tipográfica iguais. Deixar cada página montar a própria
 * estrutura foi o que, na prática, faria uma delas divergir na primeira edição.
 */

export function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />

      <article className="container max-w-3xl pb-24 pt-32 md:pt-40">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar ao início
        </Link>

        <h1 className="mt-6 font-display text-3xl leading-tight tracking-tight md:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Última atualização: {LEGAL_LAST_UPDATED}
        </p>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{intro}</p>

        {hasPendingLegalIdentity() && <PendingIdentityWarning />}

        <div className="mt-12 space-y-10">{children}</div>

        <footer className="mt-16 border-t border-border pt-8 text-sm text-muted-foreground">
          <p>
            Dúvidas sobre este documento?{" "}
            <a
              href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              className="text-foreground underline underline-offset-4"
            >
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </p>
          <p className="mt-4">
            <Link href="/termos" className="transition hover:text-foreground">
              Termos de uso
            </Link>
            {" · "}
            <Link href="/privacidade" className="transition hover:text-foreground">
              Política de privacidade
            </Link>
            {" · "}
            <Link href="/contato" className="transition hover:text-foreground">
              Contato
            </Link>
          </p>
        </footer>
      </article>
    </main>
  );
}

/**
 * Aviso exibido enquanto a identidade da parte contratante não foi preenchida.
 * Fica na página de propósito: é mais seguro o dono ver o aviso do que o
 * documento circular nomeando um marcador como parte responsável.
 */
function PendingIdentityWarning() {
  return (
    <div className="mt-8 flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="text-sm leading-relaxed">
        <p className="font-semibold text-foreground">Documento ainda não finalizado</p>
        <p className="mt-1 text-muted-foreground">
          A identificação de quem opera o {SERVICE_NAME} está pendente em{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">src/lib/legal.ts</code>.
          Enquanto isso não for preenchido, este texto serve de referência, mas não
          vincula juridicamente nenhuma parte.
        </p>
      </div>
    </div>
  );
}

/** Seção numerada do documento. */
export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl tracking-tight text-foreground">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/** Lista com marcadores, no mesmo ritmo vertical do corpo do texto. */
export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tabela responsiva. As tabelas destes documentos (dados coletados,
 * subprocessadores) são largas demais para caber em 320px sem quebrar o
 * layout — por isso a rolagem fica contida aqui, não na página.
 */
export function LegalTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-1">
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 align-top text-muted-foreground">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
