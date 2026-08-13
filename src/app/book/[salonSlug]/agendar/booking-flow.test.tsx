// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFlow } from "./booking-flow";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ salonSlug: "studio-teste" }),
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("next/image", () => ({
  default: () => <span data-testid="next-image" />,
}));
vi.mock("@/lib/cart", () => ({
  useCart: () => ({ items: [], count: 0, totalCents: 0, clear: vi.fn() }),
}));

type DeferredResponse = {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
};

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function availability(slots: string[]) {
  return new Response(JSON.stringify({ slots, popularSlot: null, occupied: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const professional = {
  id: "pro-1",
  name: "Ana Silva",
  avatarUrl: null,
  colorHex: "#7DF89B",
  specialties: ["Corte"],
  apptCount: 2,
  topPro: true,
};

const secondProfessional = {
  ...professional,
  id: "pro-2",
  name: "Bruno Costa",
  topPro: false,
};

const baseProps = {
  salonId: "salon-1",
  salonName: "Studio Teste",
  salonAddress: "Rua Teste, 1",
  currency: "BRL",
  timezone: "America/Sao_Paulo",
  cancelPolicyHours: 4,
  todayDate: "2026-08-13",
  services: [{
    id: "service-1",
    name: "Corte",
    description: null,
    priceCents: 5000,
    durationMin: 30,
    colorHex: "#7DF89B",
    category: "Cabelo",
    imageUrl: null,
    professionals: [professional],
  }],
  initialServiceIds: ["service-1"],
  clientSession: {
    clientId: "client-1",
    salonId: "salon-1",
    name: "Cliente",
    email: "cliente@example.com",
  },
};

beforeEach(() => {
  navigation.push.mockReset();
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BookingFlow availability", () => {
  it("ignora promises fora de ordem ao trocar a data", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<BookingFlow {...baseProps} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /sexta-feira, 14 de agosto de 2026/i }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    second.resolve(availability(["10:00"]));
    expect(await screen.findByRole("button", { name: "Horário 10:00" })).toBeInTheDocument();
    first.resolve(availability(["09:00"]));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Horário 09:00" })).toBeNull();
      expect(screen.getByRole("button", { name: "Horário 10:00" })).toBeInTheDocument();
    });
  });

  it("não migra um slot restaurado para outra data mesmo quando o horário coincide", async () => {
    sessionStorage.setItem("booking-state:studio-teste", JSON.stringify({
      serviceIds: ["service-1"],
      proId: "pro-1",
      date: "2026-08-13",
      slot: "09:00",
      savedAt: Date.now(),
    }));
    const first = deferredResponse();
    const second = deferredResponse();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<BookingFlow {...baseProps} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /sexta-feira, 14 de agosto de 2026/i }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    second.resolve(availability(["09:00"]));
    const sameTimeOnNewDate = await screen.findByRole("button", { name: "Horário 09:00" });
    expect(sameTimeOnNewDate).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeDisabled();

    first.resolve(availability(["09:00"]));
    await waitFor(() => {
      expect(sameTimeOnNewDate).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeDisabled();
    });
  });

  it("não migra um slot restaurado para outro profissional com o mesmo horário", async () => {
    sessionStorage.setItem("booking-state:studio-teste", JSON.stringify({
      serviceIds: ["service-1"],
      proId: "pro-1",
      date: "2026-08-13",
      slot: "09:00",
      savedAt: Date.now(),
    }));
    const first = deferredResponse();
    const second = deferredResponse();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    const propsWithTwoProfessionals = {
      ...baseProps,
      services: [{
        ...baseProps.services[0],
        professionals: [professional, secondProfessional],
      }],
    };

    render(<BookingFlow {...propsWithTwoProfessionals} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /BC Bruno/i }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    second.resolve(availability(["09:00"]));
    const sameTimeWithNewPro = await screen.findByRole("button", { name: "Horário 09:00" });
    expect(sameTimeWithNewPro).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeDisabled();

    first.resolve(availability(["09:00"]));
    await waitFor(() => {
      expect(sameTimeWithNewPro).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeDisabled();
    });
  });

  it("bloqueia o CTA no erro, restaura o slot salvo após retry e o remove se não estiver livre", async () => {
    sessionStorage.setItem("booking-state:studio-teste", JSON.stringify({
      serviceIds: ["service-1"],
      proId: "pro-1",
      date: "2026-08-13",
      slot: "09:00",
      savedAt: Date.now(),
    }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "FAIL" }), { status: 500 }))
      .mockResolvedValueOnce(availability(["09:00"]))
      .mockResolvedValueOnce(availability(["10:00"]));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<BookingFlow {...baseProps} />);
    const retry = await screen.findByRole("button", { name: "Tentar novamente" });
    expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeDisabled();
    expect(screen.getByText(/horário 09:00 e suas demais escolhas foram preservados/i)).toBeInTheDocument();

    await user.click(retry);
    const restoredSlot = await screen.findByRole("button", { name: "Horário 09:00" });
    await waitFor(() => expect(restoredSlot).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /sexta-feira, 14 de agosto de 2026/i }));
    expect(await screen.findByRole("button", { name: "Horário 10:00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Horário 09:00" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeDisabled();
  });

  it("remove o slot preservado quando o retry comprova que ele não está mais livre", async () => {
    sessionStorage.setItem("booking-state:studio-teste", JSON.stringify({
      serviceIds: ["service-1"],
      proId: "pro-1",
      date: "2026-08-13",
      slot: "09:00",
      savedAt: Date.now(),
    }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "FAIL" }), { status: 500 }))
      .mockResolvedValueOnce(availability(["10:00"]));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<BookingFlow {...baseProps} />);
    expect(await screen.findByText(/horário 09:00 e suas demais escolhas foram preservados/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByRole("button", { name: "Horário 10:00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Horário 09:00" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeDisabled();
  });

  it("respeita Retry-After, atualiza a contagem e só libera o retry no zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
        status: 429,
        headers: { "Retry-After": "2" },
      }))
      .mockResolvedValueOnce(availability(["09:00"]));
    vi.stubGlobal("fetch", fetcher);
    render(<BookingFlow {...baseProps} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    let retry = screen.getByRole("button", { name: "Tentar novamente em 2s" });
    expect(retry).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    retry = screen.getByRole("button", { name: "Tentar novamente em 1s" });
    expect(retry).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    retry = screen.getByRole("button", { name: "Tentar novamente" });
    expect(retry).toBeEnabled();

    await act(async () => {
      retry.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Horário 09:00" })).toBeInTheDocument();
  });

  it("reinicia o cooldown quando retries consecutivos recebem novos 429", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
        status: 429,
        headers: { "Retry-After": "1" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
        status: 429,
        headers: { "Retry-After": "3" },
      }))
      .mockResolvedValueOnce(availability(["09:00"]));
    vi.stubGlobal("fetch", fetcher);
    render(<BookingFlow {...baseProps} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("button", { name: "Tentar novamente em 1s" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => {
      screen.getByRole("button", { name: "Tentar novamente" }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Tentar novamente em 3s" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByRole("button", { name: "Tentar novamente em 1s" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => {
      screen.getByRole("button", { name: "Tentar novamente" }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Horário 09:00" })).toBeInTheDocument();
  });

  it("mantém o cooldown ao trocar a data e faz retry apenas da consulta atual", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
        status: 429,
        headers: { "Retry-After": "2" },
      }))
      .mockResolvedValueOnce(availability(["10:00"]));
    vi.stubGlobal("fetch", fetcher);
    render(<BookingFlow {...baseProps} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      screen.getByRole("button", { name: /sexta-feira, 14 de agosto de 2026/i }).click();
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Revisar reserva" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tentar novamente em 2s" })).toBeDisabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await act(async () => {
      screen.getByRole("button", { name: "Tentar novamente" }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("date=2026-08-14");
    expect(screen.getByRole("button", { name: "Horário 10:00" })).toBeInTheDocument();
  });

  it("limpa o timer do cooldown ao desmontar", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
        status: 429,
        headers: { "Retry-After": "30" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const view = render(<BookingFlow {...baseProps} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "Tentar novamente em 30s" })).toBeDisabled();
    const activeTimers = vi.getTimerCount();
    expect(activeTimers).toBeGreaterThan(0);

    view.unmount();
    expect(vi.getTimerCount()).toBe(activeTimers - 1);
  });
});
