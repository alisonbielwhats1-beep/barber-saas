// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({
  day: vi.fn(),
  days: vi.fn(),
  receive: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("./receipt-actions", () => ({
  getReceiptDay: mocks.day,
  getReceiptDays: mocks.days,
  receiveBatch: mocks.receive,
}));
vi.mock("./receipt-button", () => ({ ReceiptButton: () => null }));
import { ReceiptWorkspace } from "./receipt-workspace";
const row = (id: string, status = "COMPLETED") => ({
  id,
  version: 1,
  startAt: "2026-09-12T15:00:00Z",
  status,
  eligible: true,
  name: id,
  professional: "Profissional",
  service: "Corte",
  baseCents: 5000,
  products: [],
});
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.day.mockResolvedValue({
    timezone: "America/Sao_Paulo",
    currency: "BRL",
    today: "2026-09-13",
    receivedDate: "2026-09-12",
    services: [{ id: "extra", name: "Barba", priceCents: 2000 }],
    paid: [],
    rows: [row("Ana"), row("Bruno", "CONFIRMED")],
  });
  mocks.days.mockResolvedValue({
    today: "2026-09-13",
    days: [
      {
        date: "2026-09-12",
        count: 2,
        pendingCount: 2,
        received: 0,
        pending: 10000,
      },
    ],
  });
});
describe("baixa em lote", () => {
  it("receives only three of four appointments with independent payment methods", async () => {
    const user = userEvent.setup();
    const value = await mocks.day();
    mocks.day.mockResolvedValue({ ...value, rows: [row("Ana"), row("Bruno"), row("Carla"), row("Daniel")] });
    mocks.receive.mockResolvedValue([]);
    render(<ReceiptWorkspace date="2026-09-12" />);
    await user.click(screen.getByText("Registrar recebimentos"));
    await screen.findByLabelText("Selecionar Daniel");
    await user.click(screen.getByLabelText("Selecionar Daniel"));
    await user.selectOptions(screen.getByLabelText(/Forma de pagamento de Bruno/), "CASH");
    await user.selectOptions(screen.getByLabelText(/Forma de pagamento de Carla/), "CREDIT_CARD");
    await user.click(screen.getByRole("button", { name: /Dar baixa em 3/ }));
    await waitFor(() => expect(mocks.receive).toHaveBeenCalledTimes(1));
    expect(mocks.receive.mock.calls[0][0].rows).toEqual([
      expect.objectContaining({ id: "Ana", method: "PIX" }),
      expect.objectContaining({ id: "Bruno", method: "CASH" }),
      expect.objectContaining({ id: "Carla", method: "CREDIT_CARD" }),
    ]);
    expect(screen.getByLabelText("Selecionar Daniel")).not.toBeChecked();
  });

  it("combines selected days without paying on selection and keeps line methods independent of optional bulk application", async () => {
    const user = userEvent.setup();
    const value = await mocks.day();
    mocks.days.mockResolvedValue({ today: "2026-09-13", days: ["2026-09-12", "2026-09-11"].map(date => ({ date, count: 2, pendingCount: 2, received: 0, pending: 10000 })) });
    mocks.day.mockImplementation(async (date: string) => ({ ...value, rows: [row(`${date}-A`), row(`${date}-B`)].map(r => ({ ...r, startAt: `${date}T15:00:00Z` })) }));
    mocks.receive.mockResolvedValue([]);
    render(<ReceiptWorkspace history />);
    await user.click(await screen.findByLabelText("Selecionar dia 12/09/2026"));
    await user.click(screen.getByLabelText("Selecionar dia 11/09/2026"));
    expect(mocks.receive).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Conferir 2 dia(s) selecionado(s)" }));
    await screen.findByLabelText("Selecionar 2026-09-12-B");
    await user.click(screen.getByLabelText("Selecionar 2026-09-12-B"));
    await user.selectOptions(screen.getByLabelText(/Aplicar a mesma forma/), "CASH");
    await user.selectOptions(screen.getByLabelText(/Forma de pagamento de 2026-09-11-A/), "DEBIT_CARD");
    expect(screen.getByLabelText(/Forma de pagamento de 2026-09-12-B/)).toHaveValue("PIX");
    await user.click(screen.getByRole("button", { name: /Dar baixa em 3/ }));
    await waitFor(() => expect(mocks.receive).toHaveBeenCalledTimes(1));
    expect(mocks.receive.mock.calls[0][0]).toMatchObject({ receivedDate: "2026-09-12", rows: [
      { id: "2026-09-11-A", method: "DEBIT_CARD" },
      { id: "2026-09-11-B", method: "CASH" },
      { id: "2026-09-12-A", method: "CASH" },
    ] });
  });

  it("does not show a partial list when a day fails and retries all selected days", async () => {
    const user = userEvent.setup();
    const value = await mocks.day();
    mocks.day.mockRejectedValueOnce(new Error("network"));
    render(<ReceiptWorkspace date="2026-09-12" />);
    await user.click(screen.getByText("Registrar recebimentos"));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Selecionar Ana")).not.toBeInTheDocument();
    mocks.day.mockResolvedValue(value);
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByLabelText("Selecionar Ana");
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("starts with yesterday, preserves unchecked appointments and submits reviewed extra values", async () => {
    const user = userEvent.setup();
    render(<ReceiptWorkspace date="2026-09-12" />);
    await user.click(
      screen.getByRole("button", { name: "Registrar recebimentos" }),
    );
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Data do recebimento")).toHaveValue(
        "2026-09-12",
      ),
    );
    expect(screen.getByLabelText("Selecionar Ana")).toBeChecked();
    expect(screen.getByLabelText("Selecionar Bruno")).not.toBeChecked();
    const ana = screen.getByLabelText("Selecionar Ana").closest("article")!;
    await user.click(within(ana).getByText(/Adicionar serviços realizados/));
    await user.selectOptions(
      within(ana).getByRole("combobox", { name: "Adicionar serviço para Ana" }),
      "extra",
    );
    await user.type(within(ana).getByLabelText("Acréscimo (R$)"), "10,50");
    await user.type(
      within(ana).getByLabelText("Motivo do acréscimo de Ana"),
      "Acabamento especial",
    );
    mocks.receive.mockResolvedValue([
      { id: "Ana", success: true, message: "Recebido" },
    ]);
    await user.click(screen.getByRole("button", { name: /Dar baixa em 1/ }));
    await waitFor(() =>
      expect(mocks.receive).toHaveBeenCalledWith(
        expect.objectContaining({
          receivedDate: "2026-09-12",
          finalize: false,
          rows: [
            expect.objectContaining({
              id: "Ana",
              extraServiceIds: ["extra"],
              surchargeCents: 1050,
              expectedTotalCents: 8050,
            }),
          ],
        }),
      ),
    );
    expect(screen.queryByLabelText("Selecionar Ana")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Selecionar Bruno")).toBeInTheDocument();
  });
  it("keeps only failed rows for retry and prevents resubmission while awaiting the server", async () => {
    const user = userEvent.setup();
    render(<ReceiptWorkspace date="2026-09-12" />);
    await user.click(screen.getByText("Registrar recebimentos"));
    await screen.findByLabelText("Selecionar Ana");
    await user.click(screen.getByText("Selecionar todos"));
    await user.click(screen.getByLabelText(/Confirmo que os selecionados/));
    let resolve!: (value: unknown) => void;
    mocks.receive.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const submit = screen.getByRole("button", { name: /Dar baixa em 2/ });
    await user.click(submit);
    expect(screen.getByRole("button", { name: "Registrando…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Registrando…" }));
    expect(mocks.receive).toHaveBeenCalledTimes(1);
    resolve([
      { id: "Ana", success: true, message: "Recebido" },
      { id: "Bruno", success: false, message: "Preço mudou" },
    ]);
    await screen.findByText("Preço mudou");
    expect(screen.queryByLabelText("Selecionar Ana")).not.toBeInTheDocument();
    const first = mocks.receive.mock.calls[0]![0];
    mocks.receive.mockResolvedValue([
      { id: "Bruno", success: true, message: "Recebido" },
    ]);
    await user.click(screen.getByRole("button", { name: /Dar baixa em 1/ }));
    await waitFor(() => expect(mocks.receive).toHaveBeenCalledTimes(2));
    expect(mocks.receive.mock.calls[1]![0].rows[0].idempotencyKey).toBe(
      first.rows[1].idempotencyKey,
    );
  });
});
