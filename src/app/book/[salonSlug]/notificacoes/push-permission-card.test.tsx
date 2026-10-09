// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushPermissionCard } from "./push-permission-card";

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/example",
  keys: { p256dh: "public", auth: "secret" },
};

function installedApp(existingSubscription: typeof subscription | null) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existingSubscription),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration) },
  });
  vi.stubGlobal("PushManager", {});
  const requestPermission = vi.fn().mockResolvedValue("granted");
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  return { pushManager, requestPermission };
}

describe("convite de push para cliente que já instalou o app", () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "standalone");
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("mostra o convite na home e vincula o aparelho só depois do toque", async () => {
    const { pushManager, requestPermission } = installedApp(null);
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "POST" ? { active: true } : { enabled: true, publicKey: "AQ" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    render(<PushPermissionCard salonSlug="studio-martinelli" placement="home" />);
    // O convite desce no topo depois da abertura do app (2,8 s).
    const button = await screen.findByRole("button", { name: "Ativar" }, { timeout: 4000 });
    expect(screen.getByRole("dialog", { name: "Lembretes de horário" })).toBeInTheDocument();
    expect(screen.getByText("Aviso na véspera e no dia")).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();

    await userEvent.setup().click(button);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Lembretes de horário" })).not.toBeInTheDocument());
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/client/push?salon=studio-martinelli", expect.objectContaining({ method: "POST" }));
  });

  it("não repete o convite se a conta já vinculou este aparelho", async () => {
    installedApp(subscription);
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "PUT" ? { active: true } : { enabled: true, publicKey: "AQ" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    render(<PushPermissionCard salonSlug="studio-martinelli" placement="home" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/api/client/push?salon=studio-martinelli", expect.objectContaining({ method: "PUT" }),
    ));
    expect(screen.queryByRole("dialog", { name: "Lembretes de horário" })).not.toBeInTheDocument();
  });

  it("fecha o convite sem pedir permissão e não o repete na mesma visita", async () => {
    const { requestPermission } = installedApp(null);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled: true, publicKey: "AQ" }), { status: 200 })));

    const first = render(<PushPermissionCard salonSlug="studio-martinelli" placement="home" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Fechar" }, { timeout: 4000 }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Lembretes de horário" })).not.toBeInTheDocument());
    expect(requestPermission).not.toHaveBeenCalled();
    first.unmount();

    render(<PushPermissionCard salonSlug="studio-martinelli" placement="home" />);
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect(screen.queryByRole("dialog", { name: "Lembretes de horário" })).not.toBeInTheDocument();
  }, 10_000);

  it("não oferece ativação enquanto o recurso estiver desligado", async () => {
    installedApp(null);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    render(<PushPermissionCard salonSlug="studio-martinelli" placement="home" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "Lembretes de horário" })).not.toBeInTheDocument();
  });
});
