// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { VisitBooking } from "./visit-booking";
const m = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push, refresh: m.refresh }),
}));
vi.mock("@/lib/cart", () => ({
  useCart: () => ({ items: [], totalCents: 0, clear: m.clear }),
}));
vi.mock("./dependent-picker", () => ({ DependentPicker: () => null }));
const items = [
  {
    serviceId: "hair",
    serviceName: "Corte",
    professionalId: "p1",
    professionalName: "Anderson",
    startLocal: "2026-10-04T15:00",
    endLocal: "2026-10-04T15:30",
    durationMin: 30,
    priceCents: 5000,
    priceType: "FIXED",
    priceNote: null,
  },
  {
    serviceId: "nails",
    serviceName: "Unhas",
    professionalId: "p2",
    professionalName: "Tati",
    startLocal: "2026-10-04T15:30",
    endLocal: "2026-10-04T16:30",
    durationMin: 60,
    priceCents: 6000,
    priceType: "FIXED",
    priceNote: null,
  },
];
const plan = {
  items,
  totalCents: 11000,
  startLocal: items[0]!.startLocal,
  endLocal: items[1]!.endLocal,
  quote: "a".repeat(64),
};
const props = {
  salonId: "salon-a",
  salonSlug: "studio",
  salonName: "Studio",
  services: items.map((i) => ({
    id: i.serviceId,
    name: i.serviceName,
    durationMin: i.durationMin,
    priceCents: i.priceCents,
    professionals: [{ id: i.professionalId, name: i.professionalName }],
  })),
  serviceIds: ["hair", "nails"],
  today: "2026-10-04",
  maxDate: "2026-11-30",
  currency: "BRL",
  authenticated: true,
  cancelPolicyHours: 2,
  onBack: vi.fn(),
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("confirma os dois profissionais uma única vez e mantém a tela de sucesso", async () => {
  let finish: (value: Response) => void = () => {};
  const fetcher = vi.fn().mockImplementation((url: string) =>
    url.endsWith("availability")
      ? Promise.resolve(json({ plans: [plan] }))
      : new Promise<Response>((resolve) => {
          finish = resolve;
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<VisitBooking {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /15:00.*16:30/ }));
  fireEvent.click(screen.getByRole("button", { name: "Revisar minha visita" }));
  const confirm = screen.getByRole("button", { name: "Confirmar visita" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(fetcher.mock.calls.filter((c) => c[0] === "/api/visits")).toHaveLength(
    1,
  );
  const body = JSON.parse(
    fetcher.mock.calls.find((c) => c[0] === "/api/visits")![1].body,
  );
  expect(
    body.choices.map((c: { professionalId: string }) => c.professionalId),
  ).toEqual(["p1", "p2"]);
  expect(body).not.toHaveProperty("manual");
  await act(async () => finish(json({ appointmentIds: ["a", "b"] })));
  await screen.findByRole("heading", { name: "Visita confirmada" });
  expect(
    screen.getByRole("link", { name: "Ver minha visita" }),
  ).toHaveAttribute("href", "/book/studio/minhas");
});
it("não confirma parcialmente e pede nova consulta quando uma vaga é ocupada", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith("availability")
            ? json({ plans: [plan] })
            : json(
                { error: "Horário ocupado. Nenhum atendimento reservado." },
                409,
              ),
        ),
      ),
  );
  render(<VisitBooking {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /15:00.*16:30/ }));
  fireEvent.click(screen.getByRole("button", { name: "Revisar minha visita" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar visita" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Revisar minha visita" }),
  ).toBeDisabled();
  expect(m.clear).not.toHaveBeenCalled();
});
it("consulta sem conta e preserva a visita antes de pedir login", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(() => Promise.resolve(json({ plans: [plan] })));
  vi.stubGlobal("fetch", fetcher);
  render(<VisitBooking {...props} authenticated={false} />);
  fireEvent.click(await screen.findByRole("button", { name: /15:00.*16:30/ }));
  fireEvent.click(screen.getByRole("button", { name: "Revisar minha visita" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Entrar para confirmar visita" }),
  );
  expect(m.push).toHaveBeenCalledWith(
    expect.stringContaining("/welcome?returnTo="),
  );
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(
    JSON.parse(sessionStorage.getItem("visit-selection:studio")!).choices,
  ).toHaveLength(2);
});
it("descarta resposta antiga depois de mudar de dia", async () => {
  let old: (r: Response) => void = () => {};
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          old = resolve;
        }),
    )
    .mockImplementation(() => Promise.resolve(json({ plans: [] })));
  vi.stubGlobal("fetch", fetcher);
  render(<VisitBooking {...props} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("Dia da visita"), {
    target: { value: "2026-10-05" },
  });
  await screen.findByText(/Não encontramos horários/);
  await act(async () => old(json({ plans: [plan] })));
  expect(
    screen.queryByRole("button", { name: /15:00.*16:30/ }),
  ).not.toBeInTheDocument();
});
