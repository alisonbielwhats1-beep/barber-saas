import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "SalonSaaS — Gestão e agendamento para beleza e bem-estar",
  description:
    "Agenda online, clientes, equipe e gestão para barbearias, salões, manicures, estética e espaços multisserviços.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SalonSaaS",
  },
  openGraph: {
    title: "SalonSaaS — Seu espaço organizado, sua agenda em movimento",
    description:
      "Uma plataforma de gestão e agendamento que se adapta ao seu negócio de beleza e bem-estar.",
    type: "website",
    locale: "pt_BR",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
