/** The selected Flair symbol and lettering use theme-aware alpha masks. */
export function BrandLogo({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
  return <span className={`ef-logo ${className}`} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : "Everflair"} aria-hidden={decorative || undefined} />;
}

export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`ef-mark ${className}`} aria-hidden="true" />;
}
