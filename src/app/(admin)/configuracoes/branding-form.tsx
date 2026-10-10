"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, Loader2, ExternalLink, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ui/image-upload";
import { toast } from "@/components/ui/toast";
import { SEGMENTS } from "@/lib/segments";
import { normalizeImageUrl } from "@/lib/images";
import { cn } from "@/lib/utils";
import { updateSalonBranding } from "./actions";
import { checkboxClass, labelClass, noteClass, selectClass, SettingsBlock, SettingsField, textareaClass } from "./settings-ui";

export type Branding = {
  slug: string;
  segment: string | null;
  description: string | null;
  coverUrl: string | null;
  coverShowName: boolean;
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
  const colorId = useId();

  const [segment, setSegment] = useState(branding.segment ?? "");
  const [color, setColor] = useState(branding.themeColorHex ?? "");
  const [coverUrl, setCoverUrl] = useState(normalizeImageUrl(branding.coverUrl) ?? "");
  const [coverShowName, setCoverShowName] = useState(branding.coverShowName);
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
          coverShowName,
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
    <form onSubmit={onSubmit} className="space-y-3.5 lg:space-y-4">
      <SettingsBlock
        title="Aparência da vitrine"
        hint="É o que o cliente vê na sua página pública de agendamento."
      >
        <SettingsField label="Tipo de negócio" hint="Ajusta textos e imagens padrão. Não limita os serviços que você pode cadastrar.">
          <select
            aria-label="Tipo de negócio"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className={selectClass}
          >
            <option value="">Não definido</option>
            {SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </SettingsField>

        <SettingsField label="Apresentação">
          <textarea
            name="description"
            defaultValue={branding.description ?? ""}
            rows={3}
            maxLength={600}
            placeholder="Conte em poucas linhas o que o seu espaço tem de diferente."
            className={textareaClass}
          />
        </SettingsField>

        <div className="flex min-w-0 flex-col gap-1.5">
          <p className={labelClass}>Foto de perfil do estabelecimento</p>
          <p className={noteClass}>
            Aparece ao lado do nome para seus clientes. Use uma foto quadrada do
            salão ou o seu logotipo.
          </p>
          <div className="mt-1.5 max-w-sm">
            <ImageUpload
              value={logoUrl}
              onChange={setLogoUrl}
              folder="branding"
              aspectRatio="landscape"
              objectFit="contain"
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <p className={labelClass}>Foto de capa da página de agendamento</p>
          <p className={noteClass}>
            Você pode enviar uma foto real do espaço ou manter a imagem padrão do
            tipo de estabelecimento escolhido acima.
          </p>
          <div className={cn("mt-1.5 flex flex-col gap-2.5 rounded-[14px] border p-3", !coverUrl ? "border-muted-foreground/60 bg-muted/40" : "border-border-strong")}>
            <div className="relative aspect-[21/8] max-h-[170px] w-full overflow-hidden rounded-xl border border-border-strong">
              <Image
                src={SEGMENTS.find((item) => item.id === segment)?.accentImage ?? SEGMENTS[0].accentImage}
                alt="Prévia da foto padrão"
                fill
                quality={95}
                sizes="(max-width: 640px) 90vw, 760px"
                className="object-cover"
              />
              {!coverUrl && (
                <span className="absolute left-2.5 top-2.5 inline-flex min-h-[22px] items-center rounded-full bg-card px-2.5 text-xs font-medium text-foreground">
                  Padrão selecionado
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">Imagem padrão do segmento</p>
                <p className={noteClass}>Sem custo e sempre disponível.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setCoverUrl("")} disabled={!coverUrl}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" /> Usar padrão
              </Button>
            </div>
          </div>
          <div className={cn("mt-1.5 flex flex-col gap-2.5 rounded-[14px] border p-3", coverUrl ? "border-muted-foreground/60 bg-muted/40" : "border-border-strong")}>
            <p className="text-sm font-medium">Minha foto do estabelecimento</p>
            <div className="max-w-sm">
              <ImageUpload
                value={coverUrl}
                onChange={setCoverUrl}
                folder="branding"
                aspectRatio="landscape"
              />
            </div>
            {coverUrl && (
              <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className={cn(checkboxClass, "mt-0.5")}
                  checked={coverShowName}
                  onChange={(e) => setCoverShowName(e.target.checked)}
                />
                <span>
                  Mostrar o nome do estabelecimento sobre a capa
                  <span className={cn(noteClass, "mt-0.5 block")}>
                    Desmarque se a sua imagem já traz o nome, para não aparecer duas vezes.
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={colorId} className={labelClass}>Cor da marca</label>
          <div className="flex min-w-0 items-center gap-2.5">
            <input
              type="color"
              value={color || "#2ECC8B"}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Escolher cor da marca"
              className="h-11 w-[52px] shrink-0 cursor-pointer rounded-[10px] border border-border-strong bg-background p-[3px] lg:h-10"
            />
            <Input
              id={colorId}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#2ECC8B"
              className="font-mono tabular-nums"
            />
            {color && (
              <Button type="button" variant="outline" size="sm" onClick={() => setColor("")}>
                Limpar
              </Button>
            )}
          </div>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Contato e redes">
        <div className="grid gap-3.5 sm:grid-cols-2 sm:gap-4">
          <SettingsField label="WhatsApp">
            <Input
              name="whatsapp"
              defaultValue={branding.whatsapp ?? ""}
              placeholder="(11) 90000-0000"
            />
          </SettingsField>
          <SettingsField label="Instagram">
            <Input
              name="instagram"
              defaultValue={branding.instagram ?? ""}
              placeholder="@seuespaco"
            />
          </SettingsField>
        </div>
      </SettingsBlock>

      <SettingsBlock title="Formas de pagamento aceitas">
        <div role="group" aria-label="Formas de pagamento aceitas" className="flex flex-wrap gap-2">
          {Object.entries(PAYMENT_LABELS).map(([value, label]) => {
            const on = methods.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleMethod(value)}
                aria-pressed={on}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center rounded-[10px] border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9",
                  on
                    ? "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    : "border-border-strong bg-transparent font-medium text-foreground hover:bg-card-hover",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </SettingsBlock>

      <SettingsBlock title="Informações importantes">
        <SettingsField label="Informações importantes" hideLabel>
          <textarea
            name="importantInfo"
            defaultValue={branding.importantInfo ?? ""}
            rows={2}
            maxLength={600}
            placeholder="Estacionamento, tolerância de atraso, política de cancelamento…"
            className={textareaClass}
          />
        </SettingsField>
      </SettingsBlock>

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm text-foreground">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Salvando…
            </>
          ) : (
            "Salvar vitrine"
          )}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <Check aria-hidden="true" className="h-4 w-4" /> Salvo
          </span>
        )}
        <a
          href={`/book/${branding.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9"
        >
          Ver minha página <ExternalLink aria-hidden="true" className="h-4 w-4" />
        </a>
      </div>
    </form>
  );
}
