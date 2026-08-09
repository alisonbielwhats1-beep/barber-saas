import Image from "next/image";
import { CalendarCheck2, Sparkles } from "lucide-react";
import { SEGMENTS } from "@/lib/segments";

export function AuthShowcase({ mode }: { mode: "login" | "signup" }) {
  return (
    <aside
      data-business-experience="espaco-misto"
      data-experience-direction="modular"
      className="experience-scope relative hidden min-h-dvh overflow-hidden border-r border-border lg:block"
    >
      <div className="absolute inset-0 grid grid-cols-5">
        {SEGMENTS.map((segment, index) => (
          <div key={segment.id} className="relative overflow-hidden border-r border-white/10 last:border-r-0">
            <Image
              src={segment.accentImage}
              alt=""
              fill
              priority={index < 2}
              sizes="10vw"
              className="object-cover saturate-[0.78]"
            />
            <span className="absolute inset-0 bg-black/25" />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-background/45 via-background/15 to-background" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/30 via-transparent to-background/30" />

      <div className="relative flex min-h-dvh flex-col justify-end p-8 xl:p-12">
        <div className="max-w-xl rounded-[2rem] border border-white/15 bg-background/72 p-7 shadow-2xl backdrop-blur-2xl xl:p-9">
          <span className="experience-icon-surface inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            Um produto, cinco experiências
          </span>
          <h2 className="mt-6 max-w-lg font-display text-4xl leading-[1.02] tracking-[-0.035em] xl:text-5xl">
            {mode === "login"
              ? "Sua operação continua exatamente de onde você parou."
              : "Comece com uma experiência feita para o seu tipo de negócio."}
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground xl:text-base xl:leading-7">
            Agenda, equipe, clientes e resultados com uma apresentação que respeita a identidade do estabelecimento.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {SEGMENTS.map((segment) => (
              <span
                key={segment.id}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-foreground/85"
              >
                {segment.shortLabel}
              </span>
            ))}
          </div>
          <div className="mt-7 flex items-center gap-3 border-t border-white/10 pt-5 text-sm text-foreground/85">
            <span className="experience-icon-surface grid h-10 w-10 place-items-center rounded-xl border">
              <CalendarCheck2 aria-hidden="true" className="h-4 w-4" />
            </span>
            <span>Seu dia, sua equipe e seus clientes em um só lugar.</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
