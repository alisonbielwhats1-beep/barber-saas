"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, Loader2, ExternalLink, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ui/image-upload";
import { toast } from "@/components/ui/toast";
import { SEGMENTS } from "@/lib/segments";
import { normalizeImageUrl } from "@/lib/images";
import { updateSalonBranding } from "./actions";

export type Branding = {
  slug: string;
  segment: string | null;
  description: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  themeColorHex: string | null;
  instagram: string | null;
  whatsapp: string | null;
  paymentMethods: string | null;
  importantInfo: string | null;
};

const PAYMENT_LABELS: Record<string, string> = {
  PIX: "Pix",
  CASH: "Dinheiro",
  CREDIT_CARD: "Crédito",
  DEBIT_CARD: "Débito",
  TRANSFER: "Transferência",
};

export function BrandingForm({ branding }: { branding: Branding }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [segment, setSegment] = useState(branding.segment ?? "");
  const [color, setColor] = useState(branding.themeColorHex ?? "");
  const [coverUrl, setCoverUrl] = useState(normalizeImageUrl(branding.coverUrl) ?? "");
  const [logoUrl, setLogoUrl] = useState(normalizeImageUrl(branding.logoUrl) ?? "");
  const [methods, setMethods] = useState<string[]>(
    branding.paymentMethods ? branding.paymentMethods.split(",").filter(Boolean) : [],
  );

  function toggleMethod(m: string) {
    setMethods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const f = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        await updateSalonBranding({
          segment: segment || null,
          description: String(f.get("description") ?? ""),
          coverUrl,
          logoUrl,
          themeColorHex: color || null,
          instagram: String(f.get("instagram") ?? ""),
          whatsapp: String(f.get("whatsapp") ?? ""),
          paymentMethods: methods as never,
          importantInfo: String(f.get("importantInfo") ?? ""),
        });
        setSaved(true);
        toast("Vitrine atualizada", "success");
        router.refresh();
        setTimeout(() => setSaved(false), 2500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao salvar";
        setError(msg);
        toast(msg, "error");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Section
        title="Aparência da vitrine"
        hint="É o que o cliente vê na sua página pública de agendamento."
      >
        <Field label="Tipo de negócio">
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Não definido</option>
            {SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Ajusta textos e imagens padrão. Não limita os serviços que você pode
            cadastrar.
          </p>
        </Field>

        <Field label="Apresentação">
          <textarea
            name="description"
            defaultValue={branding.description ?? ""}
            rows={3}
            maxLength={600}
            placeholder="Conte em poucas linhas o que o seu espaço tem de diferente."
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Foto de perfil do estabelecimento">
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            Aparece ao lado do nome para seus clientes. Use uma foto quadrada do
            salão ou o seu logotipo.
          </p>
          <div className="max-w-sm">
            <ImageUpload
              value={logoUrl}
              onChange={setLogoUrl}
              folder="branding"
              aspectRatio="landscape"
              objectFit="contain"
            />
          </div>
        </Field>

        <Field label="Foto de capa da página de agendamento">
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            Você pode enviar uma foto real do espaço ou manter a imagem padrão do
            tipo de estabelecimento escolhido acima.
          </p>
          <div className={`rounded-2xl border p-3 ${!coverUrl ? "border-primary bg-primary/5" : "border-border"}`}>
            <div className="relative aspect-video overflow-hidden rounded-xl">
              <Image
                src={SEGMENTS.find((item) => item.id === segment)?.accentImage ?? SEGMENTS[0].accentImage}
                alt="Prévia da foto padrão"
                fill
                quality={95}
                sizes="(max-width: 640px) 90vw, 1200px"
                className="object-cover"
              />
              {!coverUrl && (
                <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white">
                  Padrão selecionado
                </span>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Imagem padrão do segmento</p>
                <p className="text-[11px] text-muted-foreground">Sem custo e sempre disponível.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setCoverUrl("")} disabled={!coverUrl}>
                <RotateCcw className="h-3.5 w-3.5" /> Usar padrão
              </Button>
            </div>
          </div>
          <div className={`mt-3 rounded-2xl border p-3 ${coverUrl ? "border-primary bg-primary/5" : "border-border"}`}>
            <p className="mb-3 text-sm font-medium">Minha foto do estabelecimento</p>
            <ImageUpload
              value={coverUrl}
              onChange={setCoverUrl}
              folder="branding"
              aspectRatio="landscape"
            />
          </div>
        </Field>

        <Field label="Cor da marca">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color || "#2ECC8B"}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Escolher cor da marca"
              className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background"
            />
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#2ECC8B"
              className="font-mono"
            />
            {color && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setColor("")}>
                Limpar
              </Button>
            )}
          </div>
        </Field>
      </Section>

      <Section title="Contato e redes">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="WhatsApp">
            <Input
              name="whatsapp"
              defaultValue={branding.whatsapp ?? ""}
              placeholder="(11) 90000-0000"
            />
          </Field>
          <Field label="Instagram">
            <Input
              name="instagram"
              defaultValue={branding.instagram ?? ""}
              placeholder="@seuespaco"
            />
          </Field>
        </div>
      </Section>

      <Section title="Formas de pagamento aceitas">
        <div className="flex flex-wrap gap-2">
          {Object.entries(PAYMENT_LABELS).map(([value, label]) => {
            const on = methods.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleMethod(value)}
                aria-pressed={on}
                className={`min-h-11 rounded-full border px-3 py-1.5 text-[13px] transition ${
                  on
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Informações importantes">
        <textarea
          name="importantInfo"
          defaultValue={branding.importantInfo ?? ""}
          rows={2}
          maxLength={600}
          placeholder="Estacionamento, tolerância de atraso, política de cancelamento…"
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </Section>

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Salvando…
            </>
          ) : (
            "Salvar vitrine"
          )}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-success">
            <Check className="h-4 w-4" /> Salvo
          </span>
        )}
        <a
          href={`/book/${branding.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] text-primary hover:underline"
        >
          Ver minha página <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {hint && <p className="mb-4 mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      <div className={hint ? "space-y-3" : "mt-4 space-y-3"}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium">{label}</label>
      {children}
    </div>
  );
}
