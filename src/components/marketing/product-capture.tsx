import Image from "next/image";

/** Both real captures stay mounted so the atmosphere can crossfade without a blank frame. */
export function ProductCapture({ dark, sizes, alt }: { dark: boolean; sizes: string; alt: string }) {
  return (
    <div className="mk-capture-layers">
      {(["light", "dark"] as const).map((theme) => {
        const active = dark === (theme === "dark");
        return (
          <Image
            key={theme}
            src={`/images/product-agenda-${theme}.webp`}
            alt={active ? alt : ""}
            aria-hidden={!active}
            data-active={active}
            width={1200}
            height={820}
            sizes={sizes}
          />
        );
      })}
    </div>
  );
}
