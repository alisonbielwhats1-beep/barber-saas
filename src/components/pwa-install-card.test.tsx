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

  it("oculta o convite após o aceite, mas só persiste com appinstalled", async () => {
    const user = userEvent.setup();
    const { event: installEvent, prompt } = createInstallEvent("accepted");

    render(<PwaInstallCard salonName="Studio A" storageKey="studio-a" />);
    window.dispatchEvent(installEvent);

    const installButton = await screen.findByRole("button", { name: "Instalar aplicativo" });
    await user.click(installButton);

    await waitFor(() => {
      expect(prompt).toHaveBeenCalledOnce();
      expect(screen.queryByRole("region", { name: "Instalar aplicativo" })).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(pwaInstallStorageKey("studio-a"))).toBeNull();

    window.dispatchEvent(new Event("appinstalled"));
    await waitFor(() => {
      expect(localStorage.getItem(pwaInstallStorageKey("studio-a"))).toBe("installed");
    });
  });

  it("dá nova chance quando o navegador ainda oferece a instalação", async () => {
    localStorage.setItem(pwaInstallStorageKey("studio-a"), "installed");
    const { event: installEvent } = createInstallEvent("accepted");

    render(<PwaInstallCard salonName="Studio A" storageKey="studio-a" />);
    window.dispatchEvent(installEvent);

    expect(await screen.findByRole("button", { name: "Instalar aplicativo" })).toBeInTheDocument();
  });
});

function createInstallEvent(outcome: "accepted" | "dismissed") {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.defineProperty(event, "prompt", { value: prompt });
  Object.defineProperty(event, "userChoice", { value: Promise.resolve({ outcome }) });
  return { event, prompt };
}
