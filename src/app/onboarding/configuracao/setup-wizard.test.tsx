// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SetupData } from "@/lib/initial-setup";
const m = vi.hoisted(() => ({ service: vi.fn(), hours: vi.fn(), progress: vi.fn(), professional: vi.fn(), self: vi.fn(), push: vi.fn(), refresh: vi.fn(), copy: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: m.refresh }) }));
vi.mock("./actions", () => ({ saveSetupHours: m.hours, saveSetupProgress: m.progress, saveSetupContact: vi.fn(), saveSetupProfessional: m.professional, saveSetupService: m.service, enableMySetupAgenda: m.self }));
vi.mock("@/app/(admin)/profissionais/working-hours-form", () => ({ WorkingHoursForm: () => null }));
import { SetupWizard } from "./setup-wizard";
const data: SetupData = { salon: { name: "Espaço teste", slug: "teste", address: null, phone: null, timezone: "America/Sao_Paulo", openMinutes: 540, closeMinutes: 1080 }, userName: "Alex Souza", userId: "owner", hours: [], services: [], professionals: [], hoursConfirmed: false, status: "active", step: 0, hasAppointments: false };
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: m.copy } }); });
afterEach(cleanup);
function show(step: number, extra: Partial<SetupData> = {}) { render(<SetupWizard data={{ ...data, ...extra }} initialStep={step} bookingUrl="https://example.test/book/teste" nextHref="/dashboard" canCreateSelf />); }
const heading = () => screen.getByRole("heading", { level: 1 });

it("recebe o primeiro acesso com boas-vindas e só depois pergunta os dias", () => {
  show(0, { status: "new" });
  expect(heading()).toHaveTextContent("Vamos deixar sua agenda online pronta.");
  expect(screen.getByText("Olá, Alex")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Começar" }));
  expect(heading()).toHaveTextContent("Em quais dias você atende?");
  expect(m.progress).not.toHaveBeenCalled();
});

it("guia dias e depois horário, uma decisão por vez", async () => {
  show(0);
  fireEvent.click(screen.getByRole("button", { name: "Seg a sex" }));
  expect(screen.getByRole("button", { name: "Sábado" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  expect(heading()).toHaveTextContent("Qual é o seu horário nesses dias?");
  fireEvent.click(screen.getByLabelText(/Com pausa para almoço/));
  fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
  await waitFor(() => expect(m.hours).toHaveBeenCalledTimes(1));
  const rows = m.hours.mock.calls[0][0];
  expect(rows).toHaveLength(10);
  expect(rows).toContainEqual({ weekday: 1, startMinutes: 540, endMinutes: 720 });
  expect(rows).toContainEqual({ weekday: 1, startMinutes: 780, endMinutes: 1080 });
  expect(rows.some((r: { weekday: number }) => r.weekday === 6 || r.weekday === 0)).toBe(false);
});

it("não deixa avançar sem nenhum dia marcado", () => {
  show(0);
  fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
});

it("mantém os horários preenchidos quando o salvamento falha e permite tentar novamente", async () => {
  m.hours.mockRejectedValueOnce(new Error("Não foi possível salvar."));
  show(0);
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.change(screen.getByLabelText("Abre às"), { target: { value: "10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar");
  expect(screen.getByLabelText("Abre às")).toHaveValue("10:00");
  expect(m.progress).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Salvar e continuar" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
  await waitFor(() => expect(m.hours).toHaveBeenCalledTimes(2));
  expect(m.hours.mock.calls[1][0]).toContainEqual({ weekday: 1, startMinutes: 600, endMinutes: 1080 });
});

it("reabre horários diferentes por dia no modo dia a dia, sem perder o que foi salvo", () => {
  show(0, { hoursConfirmed: true, hours: [{ weekday: 2, startMinutes: 540, endMinutes: 1080 }, { weekday: 4, startMinutes: 600, endMinutes: 1200 }] });
  expect(screen.getByRole("button", { name: "Terça" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Segunda" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByLabelText(/Um horário para cada dia/)).toBeChecked();
  expect(screen.getByLabelText("Quinta início 1")).toHaveValue("10:00");
  expect(screen.getByLabelText("Quinta fim 1")).toHaveValue("20:00");
});

it("mantém os controles desabilitados enquanto aguarda a gravação", async () => {
  let finish!: () => void;
  m.hours.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  show(0);
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  const save = screen.getByRole("button", { name: "Salvar e continuar" });
  fireEvent.click(save);
  expect(save).toBeDisabled();
  expect(screen.getByRole("button", { name: "Fazer depois" })).toBeDisabled();
  fireEvent.click(save);
  expect(m.hours).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(heading()).toHaveTextContent("O que você oferece?"));
});

it("adiar persiste a etapa sem exigir conclusão", async () => {
  show(2);
  fireEvent.click(screen.getByRole("button", { name: "Fazer depois" }));
  await waitFor(() => expect(m.progress).toHaveBeenCalledWith({ step: 2, status: "deferred" }));
  await waitFor(() => expect(m.push).toHaveBeenCalledWith("/dashboard"));
});

it("revisa serviços um por vez e abre o próximo pendente após salvar", async () => {
  const services = [
    { id: "a", name: "Reflexologia podal", durationMin: 60, priceCents: 0, reviewed: false },
    { id: "b", name: "Avaliação", durationMin: 30, priceCents: 0, reviewed: false },
  ];
  show(1, { services });
  expect(screen.getByText("0 de 2 revisados")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Revisar um por vez" }));
  expect(screen.getByLabelText("Nome do serviço")).toHaveValue("Reflexologia podal");
  fireEvent.click(screen.getByRole("button", { name: "90 min" }));
  fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "120,00" } });
  expect(screen.getByText(/120,00/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Salvar e ir para o próximo" }));
  await waitFor(() => expect(m.service).toHaveBeenCalledWith({ id: "a", name: "Reflexologia podal", durationMin: 90, priceCents: 12000, freeConfirmed: false }));
  await waitFor(() => expect(screen.getByLabelText("Nome do serviço")).toHaveValue("Avaliação"));
  expect(screen.getByText(/Agora: Avaliação/)).toBeInTheDocument();
});

it("catálogo grande usa busca e abre só um editor; falha conserva dados e explica dentro da janela", async () => {
  m.service.mockRejectedValueOnce(new Error("Confirme que este serviço é gratuito."));
  const services = Array.from({ length: 90 }, (_, i) => ({ id: String(i), name: i === 80 ? "Pé e Mão" : `Corte ${i}`, durationMin: 30, priceCents: 5000, reviewed: i < 40 }));
  show(1, { services });
  expect(screen.queryByLabelText("Nome do serviço")).toBeNull();
  fireEvent.change(screen.getByLabelText("Pesquisar serviços"), { target: { value: "pe e mao" } });
  fireEvent.click(screen.getByRole("button", { name: /Pé e Mão/ }));
  expect(screen.getAllByLabelText("Nome do serviço")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar serviço" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Confirme que este serviço é gratuito.");
  expect(screen.getByLabelText("Preço (R$)")).toHaveValue("0");
  await waitFor(() => expect(screen.getByRole("button", { name: "Salvar serviço" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Fechar janela" }));
  expect(screen.getByText("Você tem alterações não salvas.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
  expect(screen.getByLabelText("Preço (R$)")).toHaveValue("0");
});

it("sugere todos os serviços e os horários da etapa 1 para a agenda própria", async () => {
  const services = [{ id: "a", name: "Reflexologia podal", durationMin: 60, priceCents: 12000, reviewed: true }];
  show(2, { services, hoursConfirmed: true, hours: [{ weekday: 2, startMinutes: 540, endMinutes: 1080 }], professionals: [{ id: "p", userId: "owner", name: "Alex Souza", serviceIds: [], hours: [] }] });
  expect(screen.queryByRole("button", { name: /Eu mesmo atendo/ })).toBeNull();
  expect(screen.getByLabelText("Reflexologia podal")).toBeChecked();
  expect(screen.getByLabelText("Usar os horários da primeira etapa nesta agenda")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Salvar profissional" }));
  await waitFor(() => expect(m.professional).toHaveBeenCalledWith({ id: "p", serviceIds: ["a"], applyHours: true }));
});

it("oferece criar a própria agenda quando o dono ainda não atende", async () => {
  show(2);
  fireEvent.click(screen.getByRole("button", { name: /Eu mesmo atendo/ }));
  await waitFor(() => expect(m.self).toHaveBeenCalledTimes(1));
});

it("explica o link e oferece cópia manual se a área de transferência falhar", async () => {
  m.copy.mockRejectedValue(new Error("clipboard denied"));
  show(3);
  expect(screen.getByLabelText("Link do aplicativo do cliente")).toHaveValue("https://example.test/book/teste");
  expect(screen.getByRole("link", { name: /Abrir aplicativo/ })).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("link", { name: /Enviar no WhatsApp/ })).toHaveAttribute("href", expect.stringContaining(encodeURIComponent("https://example.test/book/teste")));
  fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Selecione o link acima e copie");
  await waitFor(() => expect(screen.getByRole("button", { name: "Continuar depois no painel" })).toBeEnabled());
});
