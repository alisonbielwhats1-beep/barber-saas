export const PWA_BACKGROUND = "#131315";
export const PWA_ICON_VERSION = "flair-dark-1";
export const PWA_FAVICON = `/icon.svg?v=${PWA_ICON_VERSION}`;

export const PWA_ICONS = [
  {
    src: `/icon-192.png?v=${PWA_ICON_VERSION}`,
    sizes: "192x192",
    type: "image/png",
    purpose: "any" as const,
  },
  {
    src: `/icon-512.png?v=${PWA_ICON_VERSION}`,
    sizes: "512x512",
    type: "image/png",
    purpose: "any" as const,
  },
  {
    src: `/icon-maskable-512.png?v=${PWA_ICON_VERSION}`,
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable" as const,
  },
];

export const PWA_APPLE_ICON = `/apple-touch-icon-180.png?v=${PWA_ICON_VERSION}`;
