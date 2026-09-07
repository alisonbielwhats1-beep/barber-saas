import type { MetadataRoute } from "next";
import { PWA_BACKGROUND, PWA_ICONS } from "@/lib/pwa-icons";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Everflair",
    short_name: "Everflair",
    description: "Agenda e gestão para salões, barbearias e profissionais de beleza.",
    start_url: "/",
    display: "standalone",
    background_color: PWA_BACKGROUND,
    theme_color: PWA_BACKGROUND,
    lang: "pt-BR",
    icons: [...PWA_ICONS],
  };
}
