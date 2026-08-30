"use client";

import { useState, type ReactNode } from "react";
import Image, { type ImageProps } from "next/image";

type ImageWithFallbackProps = ImageProps & {
  fallback?: ReactNode;
  fallbackSrc?: ImageProps["src"];
};

function sourceKey(src: ImageProps["src"]): string {
  if (typeof src === "string") return src;
  if ("src" in src) return src.src;
  return src.default.src;
}

/** Troca uma URL que falhou sem deixar o ícone de imagem quebrada visível. */
export function ImageWithFallback({
  src,
  fallback,
  fallbackSrc,
  onError,
  alt,
  ...props
}: ImageWithFallbackProps) {
  const primaryKey = sourceKey(src);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const failed = failedKey === primaryKey;

  if (failed && fallback) return fallback;

  return (
    <Image
      {...props}
      alt={alt}
      src={failed && fallbackSrc ? fallbackSrc : src}
      onError={(event) => {
        if (!failed) setFailedKey(primaryKey);
        onError?.(event);
      }}
    />
  );
}
