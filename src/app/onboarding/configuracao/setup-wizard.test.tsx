// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SetupData } from "@/lib/initial-setup";
const m = vi.hoisted(() => ({ hours: vi.fn(), progress: vi.fn(), push: vi.fn(), refresh: vi.fn(), copy: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: m.refresh }) }));
vi.mock("./actions", () => ({ saveSetupHours: m.hours, saveSetupProgress: m.progress, saveSetupContact: vi.fn(), saveSetupProfessional: vi.fn(), saveSetupService: vi.fn(), enableMySetupAgenda: vi.fn() }));
vi.mock("@/app/(admin)/profissionais/working-hours-form", () => ({ WorkingHoursForm: () => null }));
import { SetupWizard } from "./setup-wizard";
const data: SetupData = { salon: { name: "Espaço teste", slug: "teste", address: null, phone: null, timezone: "America/Sao_Paulo", openMinutes: 540, closeMinutes: 1080 }, userName: "Alex", userId: "owner", hours: [], services: [], professionals: [], hoursConfirmed: false, status: "new", step: 0, hasAppointments: false };
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: m.copy } }); });
afterEach(cleanup);
function show(step: number) { render(<SetupWizard data={data} initialStep={step} bookingUrl="https://example.test/book/teste" nextHref="/dashboard" canCreateSelf />); }
it("mantém os horários preenchidos quando o salvamento falha e permite tentar novamente", async () => {
  m.hours.mockRejectedValueOnce(new Error("Não foi possível salvar."));
  show(0);
  fireEvent.change(screen.getByLabelText("Segunda início 1"), { target: { value: "10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar");
  expect(screen.getByLabelText("Segunda início 1")).toHaveValue("10:00");
  expect(m.progress).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Salvar e continuar" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
  await waitFor(() => expect(m.hours).toHaveBeenCalledTimes(2));
  expect(m.hours.mock.calls[1][0]).toContainEqual({ weekday: 1, startMinutes: 600, endMinutes: 1080 });
});
it("adiar persiste a etapa sem exigir conclusão", async () => {
  show(2);
  fireEvent.click(screen.getByRole("button", { name: "Fazer depois" }));
  await waitFor(() => expect(m.progress).toHaveBeenCalledWith({ step: 2, status: "deferred" }));
  await waitFor(() => expect(m.push).toHaveBeenCalledWith("/dashboard"));
});
it("mantém os controles desabilitados enquanto aguarda a gravação", async () => {
  let finish!: () => void;
  m.hours.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  show(0);
  const save = screen.getByRole("button", { name: "Salvar e continuar" });
  fireEvent.click(save);
  expect(save).toBeDisabled();
  expect(screen.getByRole("button", { name: "Fazer depois" })).toBeDisabled();
  fireEvent.click(save);
  expect(m.hours).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("O que você oferece?"));
});
it("explica o link e oferece cópia manual se a área de transferência falhar", async () => {
  m.copy.mockRejectedValue(new Error("clipboard denied"));
  show(3);
  expect(screen.getByLabelText("Link do aplicativo do cliente")).toHaveValue("https://example.test/book/teste");
  expect(screen.getByRole("link", { name: /Abrir aplicativo/ })).toHaveAttribute("target", "_blank");
  fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Selecione o link acima e copie");
  await waitFor(() => expect(screen.getByRole("button", { name: "Continuar depois no painel" })).toBeEnabled());
});
