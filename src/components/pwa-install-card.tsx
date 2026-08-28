"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Download,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type PwaPlatform = "ios" | "android" | "other";

export function detectPwaPlatform(
  userAgent: string,
  platform = "",
  maxTouchPoints = 0,
): PwaPlatform {
  const normalizedUserAgent = userAgent.toLowerCase();
  const isAppleTouchDevice =
    platform === "MacIntel" && maxTouchPoints > 1;
  if (/iphone|ipad|ipod/.test(normalizedUserAgent) || isAppleTouchDevice) {
    return "ios";
  }
  if (/android/.test(normalizedUserAgent)) return "android";
  return "other";
}

function isStandaloneMode(): boolean {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    standaloneNavigator.standalone === true
  );
}

export function PwaInstallCard({
  salonName,
  className,
  compact = false,
}: {
  salonName?: string;
  className?: string;
  compact?: boolean;
}) {
  const [platform, setPlatform] = useState<PwaPlatform | null>(null);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isStandaloneMode()) {
      setInstalled(true);
      return;
    }

    setPlatform(
      detectPwaPlatform(
        navigator.userAgent,
        navigator.platform,
        navigator.maxTouchPoints,
      ),
    );

    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      setOpen(false);
    };

    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installFromPrompt() {
    const currentPrompt = promptEvent;
    if (!currentPrompt) return;
    try {
      await currentPrompt.prompt();
      const choice = await currentPrompt.userChoice;
      if (choice.outcome === "accepted") setOpen(false);
    } catch {
      // Se o navegador recusar o prompt, os passos manuais continuam
      // disponíveis para o cliente.
      setOpen(true);
    } finally {
      setPromptEvent(null);
    }
  }

  // Evita conteúdo diferente entre SSR e hidratação e não mostra o convite
  // depois que o app já está aberto como instalado.
  if (
    platform === null ||
    installed ||
    (platform === "other" && !promptEvent)
  ) {
    return null;
  }

  const isIos = platform === "ios";
  const title = isIos ? "Adicione à tela inicial" : "Tenha o app sempre à mão";
  const description = isIos
    ? "Acesse o salão como um app, direto do seu iPhone."
    : "Agende mais rápido pelo seu celular, mesmo sem procurar o site.";
  const buttonLabel = promptEvent && !isIos
    ? "Instalar aplicativo"
    : "Ver como instalar";

  return (
    <>
      <section
        aria-label="Instalar aplicativo"
        className={cn(
          "rounded-3xl border border-primary/25 bg-primary/[0.08] p-4",
          compact && "rounded-2xl p-3",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {description}
              {salonName ? ` ${salonName} fica a um toque.` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (promptEvent && !isIos) {
              void installFromPrompt();
              return;
            }
            setOpen(true);
          }}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {buttonLabel}
        </button>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto p-5 pr-14 sm:p-6 sm:pr-16">
          <DialogTitle className="text-xl">Instalar o aplicativo</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {isIos
              ? "No iPhone, a instalação é feita pelo Safari e não exige App Store."
              : "Siga estes passos no Google Chrome para criar um atalho com aparência de aplicativo."}
          </DialogDescription>

          <ol className="space-y-3">
            {isIos ? (
              <>
                <InstallStep number="1" title="Abra no Safari">
                  Se estiver em outro navegador, copie o endereço e abra esta página no Safari.
                </InstallStep>
                <InstallStep number="2" icon={<Share className="h-4 w-4" aria-hidden="true" />} title="Toque em Compartilhar">
                  O botão fica na barra do Safari, geralmente na parte inferior da tela.
                </InstallStep>
                <InstallStep number="3" icon={<PlusSquare className="h-4 w-4" aria-hidden="true" />} title="Adicione à Tela de Início">
                  Confirme em Adicionar. O ícone do salão ficará disponível junto dos seus aplicativos.
                </InstallStep>
              </>
            ) : (
              <>
                <InstallStep number="1" title="Abra no Google Chrome">
                  Use o Chrome no Android para que a instalação fique disponível.
                </InstallStep>
                <InstallStep number="2" icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />} title="Abra o menu">
                  Toque nos três pontos no canto superior direito da tela.
                </InstallStep>
                <InstallStep number="3" icon={<Download className="h-4 w-4" aria-hidden="true" />} title="Instale o aplicativo">
                  Escolha Instalar aplicativo ou Adicionar à tela inicial e confirme.
                </InstallStep>
              </>
            )}
          </ol>

          {promptEvent && !isIos && (
            <button
              type="button"
              onClick={() => void installFromPrompt()}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Instalar agora
            </button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function InstallStep({
  number,
  icon,
  title,
  children,
}: {
  number: string;
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-background/50 p-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
        {icon ?? number}
      </span>
      <span className="min-w-0 text-sm leading-relaxed">
        <strong className="font-semibold">{title}</strong>
        <span className="mt-0.5 block text-xs text-muted-foreground">{children}</span>
      </span>
      {number === "3" && (
        <Check className="ml-auto mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      )}
    </li>
  );
}
