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
