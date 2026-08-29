// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaInstallCard, pwaInstallStorageKey } from "./pwa-install-card";

describe("PwaInstallCard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("não mostra o convite quando a instalação já foi reconhecida neste dispositivo", async () => {
    localStorage.setItem(pwaInstallStorageKey("studio-a"), "installed");

    render(<PwaInstallCard salonName="Studio A" storageKey="studio-a" />);

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Instalar aplicativo" })).not.toBeInTheDocument();
    });
  });

  it("persiste a instalação aceita pelo prompt do navegador", async () => {
    const user = userEvent.setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const installEvent = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    Object.defineProperty(installEvent, "prompt", { value: prompt });
    Object.defineProperty(installEvent, "userChoice", {
      value: Promise.resolve({ outcome: "accepted" as const }),
    });

    render(<PwaInstallCard salonName="Studio A" storageKey="studio-a" />);
    window.dispatchEvent(installEvent);

    const installButton = await screen.findByRole("button", { name: "Instalar aplicativo" });
    await user.click(installButton);

    await waitFor(() => {
      expect(prompt).toHaveBeenCalledOnce();
      expect(localStorage.getItem(pwaInstallStorageKey("studio-a"))).toBe("installed");
      expect(screen.queryByRole("region", { name: "Instalar aplicativo" })).not.toBeInTheDocument();
    });
  });
});
