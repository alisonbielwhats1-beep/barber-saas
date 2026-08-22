// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFlow } from "./booking-flow";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const cartMock = vi.hoisted(() => ({
  items: [] as Array<{ productId: string; quantity: number }>,
  count: 0,
  totalCents: 0,
  clear: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ salonSlug: "studio-teste" }),
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("next/image", () => ({
  default: () => <span data-testid="next-image" />,
}));
vi.mock("@/lib/cart", () => ({
  useCart: () => cartMock,
}));

type DeferredResponse = {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
};

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function availability(
  slots: string[],
  occupied: Array<{ appointmentId: string; time: string }> = [],
) {
  return new Response(JSON.stringify({ slots, popularSlot: null, occupied }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function apiResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
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
    priceCents: 5_000,
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
  cartMock.clear.mockReset();
  cartMock.items = [];
  cartMock.count = 0;
  cartMock.totalCents = 0;
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
});

describe("BookingFlow — confirmação e fila", () => {
  it("não envia duas confirmações enquanto a primeira está pendente", async () => {
    const post = deferredResponse();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(availability(["09:00"]))
      .mockImplementationOnce(() => post.promise);
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<BookingFlow {...baseProps} />);
    await user.click(await screen.findByRole("button", { name: "Horário 09:00" }));
    await user.click(screen.getByRole("button", { name: "Revisar reserva" }));

    const confirm = screen.getByRole("button", { name: "Confirmar reserva" });
    await user.click(confirm);
    await user.click(confirm);

    const postCalls = fetcher.mock.calls.filter(([, init]) =>
      (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCalls).toHaveLength(1);
    const body = JSON.parse(String((postCalls[0]?.[1] as RequestInit).body));
    expect(body.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(confirm).toBeDisabled();

    post.resolve(apiResponse({
      appointment: { startAt: "2026-08-13T12:00:00.000Z" },
    }, 201));

    await waitFor(() => expect(screen.getByText("Reserva confirmada")).toBeInTheDocument());
    expect(cartMock.clear).toHaveBeenCalledOnce();
  });

  it("não limpa o carrinho nem confirma quando a API retorna um horário inválido", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(availability(["09:00"]))
      .mockResolvedValueOnce(apiResponse({ appointment: { startAt: "not-a-date" } }, 201));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<BookingFlow {...baseProps} />);
    await user.click(await screen.findByRole("button", { name: "Horário 09:00" }));
    await user.click(screen.getByRole("button", { name: "Revisar reserva" }));
    await user.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    await waitFor(() => {
      expect(screen.getByText("Não foi possível confirmar agora. Verifique sua conexão e tente novamente.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Reserva confirmada")).toBeNull();
    expect(cartMock.clear).not.toHaveBeenCalled();
  });

  it("remove o slot tomado e atualiza a grade antes de permitir nova escolha", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(availability(["09:00"]))
      .mockResolvedValueOnce(apiResponse({ error: "SLOT_TAKEN" }, 409))
      .mockResolvedValueOnce(availability(["10:00"]));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<BookingFlow {...baseProps} />);
    await user.click(await screen.findByRole("button", { name: "Horário 09:00" }));
    await user.click(screen.getByRole("button", { name: "Revisar reserva" }));
    await user.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    expect(await screen.findByText(/Esse horário acabou de ser reservado/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Horário 10:00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Horário 09:00" })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("permite entrar na fila para um horário ocupado e mostra a posição", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(availability([], [{ appointmentId: "appt-1", time: "09:00" }]))
      .mockResolvedValueOnce(apiResponse({
        position: 2,
        startAt: "2026-08-13T12:00:00.000Z",
        timezone: "America/Sao_Paulo",
        serviceNames: ["Corte"],
      }, 201));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<BookingFlow {...baseProps} />);
    await user.click(await screen.findByRole("button", { name: "09:00" }));
    await user.click(screen.getByRole("button", { name: "Entrar na fila" }));

    await waitFor(() => expect(screen.getByText("#2")).toBeInTheDocument());
    expect(screen.getByText("Você entrou na fila de espera.")).toBeInTheDocument();
    const body = JSON.parse(String((fetcher.mock.calls[1]?.[1] as RequestInit).body));
    expect(body).toEqual(expect.objectContaining({
      salonId: "salon-1",
      appointmentId: "appt-1",
      professionalId: "pro-1",
      serviceIds: ["service-1"],
    }));
  });
});
