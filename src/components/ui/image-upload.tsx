"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { normalizeImageUrl } from "@/lib/images";

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  folder?: string;
  aspectRatio?: "square" | "portrait" | "landscape";
  objectFit?: "cover" | "contain";
}

export function ImageUpload({
  value,
  onChange,
  folder = "misc",
  aspectRatio = "square",
  objectFit = "cover",
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = normalizeImageUrl(value);

  const aspectClass =
    aspectRatio === "portrait"
      ? "aspect-[3/4]"
      : aspectRatio === "landscape"
        ? "aspect-video"
        : "aspect-square";
  const previewSizes =
    aspectRatio === "landscape"
      ? "(max-width: 640px) 100vw, 1200px"
      : "300px";

  async function optimizeImageForUpload(file: File): Promise<File> {
    // PNGs de marca ficam no formato original, pois a
    // conversão lossy pode borrar letras, linhas finas e logotipos dourados.
    if (
      file.type === "image/png" ||
      file.size < 350_000 ||
      typeof createImageBitmap !== "function"
    ) {
      return file;
    }

    try {
      const bitmap = await createImageBitmap(file);
      try {
        // A capa ocupa uma área larga no painel e na vitrine. Preservamos
        // mais resolução nesse caso, sem alterar o limite seguro do servidor.
        const maxDimension = aspectRatio === "landscape" ? 2_400 : 1_600;
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return file;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/webp", 0.96),
        );
        if (!blob || blob.size >= file.size * 0.98) return file;
        const baseName = file.name.replace(/\.[^/.]+$/, "") || "imagem";
        return new File([blob], `${baseName}.webp`, {
          type: "image/webp",
          lastModified: Date.now(),
        });
      } finally {
        bitmap.close();
      }
    } catch {
      // Alguns navegadores não decodificam determinados arquivos grandes.
      // O servidor ainda valida e limita o upload original com segurança.
      return file;
    }
  }

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const optimizedFile = await optimizeImageForUpload(file);
      const fd = new FormData();
      fd.append("file", optimizedFile);
      fd.append("folder", folder);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro no upload");
      onChange(json.url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setLoading(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file).finally(() => {
      e.target.value = "";
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-2">
      <div
        className={`relative w-full overflow-hidden rounded-xl border border-dashed border-border bg-muted/30 ${aspectClass}`}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {previewUrl ? (
          <>
            <Image
              src={previewUrl}
              alt="Preview"
              fill
              className={objectFit === "contain" ? "object-contain p-2" : "object-cover"}
              quality={95}
              sizes={previewSizes}
              onError={() => {
                setError("A imagem salva não está mais disponível. Envie outra imagem.");
                onChange("");
              }}
            />
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Remover imagem"
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <ImageIcon className="h-8 w-8" />
            )}
            <span className="text-xs">{loading ? "Otimizando e enviando…" : "Clique ou arraste uma imagem"}</span>
          </button>
        )}
      </div>

      {value && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {loading ? "Otimizando e enviando…" : "Trocar imagem"}
        </button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
