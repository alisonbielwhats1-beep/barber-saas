import Image from "next/image";
import type { BusinessExperience } from "@/config/business-experience";
import { BusinessExperienceIcon } from "@/components/business-experience-icon";

export function ExperienceHero({
  experience,
  eyebrow,
  title,
  description,
  children,
}: {
  experience: BusinessExperience;
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="experience-context-panel relative isolate min-h-48 overflow-hidden p-5 sm:p-7 lg:min-h-52 lg:p-8">
      <div className="absolute inset-y-0 right-0 hidden w-[42%] sm:block">
        <Image
          src={experience.imagery.accentImage}
          alt=""
          fill
          sizes="(max-width: 1023px) 42vw, 560px"
          className="object-cover opacity-75"
          style={{ objectPosition: experience.imagery.objectPosition }}
        />
        <span className="absolute inset-0 bg-gradient-to-r from-card via-card/55 to-transparent" />
        <span className="absolute inset-0 bg-gradient-to-t from-card/50 via-transparent to-card/15" />
      </div>

      <div className="relative z-10 max-w-2xl">
        <span className="experience-icon-surface mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]">
          <BusinessExperienceIcon name={experience.icon} className="h-3.5 w-3.5" />
          {eyebrow}
        </span>
        <h1 className="max-w-xl text-[27px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[34px]">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-[13px] leading-6 text-muted-foreground sm:text-[14px]">
          {description}
        </p>
        {children && <div className="mt-5 flex flex-wrap gap-2">{children}</div>}
      </div>
    </section>
  );
}
