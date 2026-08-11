import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SalonSaaS",
    short_name: "SalonSaaS",
    description: "Agenda e gestão para salões, barbearias e profissionais de beleza.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0d",
    theme_color: "#2ecc8b",
    lang: "pt-BR",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
