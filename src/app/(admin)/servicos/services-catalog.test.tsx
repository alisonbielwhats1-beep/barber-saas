// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesCatalog, type ServiceCard } from "./services-catalog";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
  duplicate: vi.fn(),
  resources: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./actions", () => ({
  createService: mocks.create,
  updateService: mocks.update,
  toggleServiceActive: mocks.toggle,
  deleteService: mocks.remove,
  duplicateService: mocks.duplicate,
}));
vi.mock("./resource-actions", () => ({ listResources: mocks.resources }));

const base: ServiceCard = {
  id: "service-corte",
  name: "Corte masculino",
  description: null,
  durationMin: 30,
  priceCents: 4500,
  costCents: 0,
  category: "Corte",
  imageUrl: null,
  colorHex: null,
  active: true,
  sold: 3,
  revenueCents: 13500,
  proCount: 2,
};
const services: ServiceCard[] = [base, { ...base, id: "service-barba", name: "Barba", category: "Barba", priceCents: 3500 }];

function mount(canManage = true) {
  return render(<ServicesCatalog services={services} canManage={canManage} canSeeFinancial />);
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.duplicate.mockReset().mockResolvedValue(undefined);
  mocks.resources.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ServicesCatalog: tocar na linha abre a edição", () => {
  it("abre o formulário de edição do serviço ao clicar na linha", async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Editar Corte masculino" }));

    const dialog = await screen.findByRole("dialog", { name: "Editar serviço" });
    expect(dialog.querySelector("input[name=name]")).toHaveValue("Corte masculino");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("abre pelo teclado: o nome da linha recebe foco e responde a Enter", async () => {
    const user = userEvent.setup();
    mount();

    await user.tab();
    const focusable = screen.getAllByRole("button", { name: /^Editar / });
    focusable[0]!.focus();
    expect(focusable[0]).toHaveFocus();
    await user.keyboard("{Enter}");

    await screen.findByRole("dialog", { name: "Editar serviço" });
  });

  it("o menu ⋮ continua abrindo a mesma edição, sem disparar a linha antes", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: "Mais opções para Barba" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: "Editar" }));

    const dialog = await screen.findByRole("dialog", { name: "Editar serviço" });
    expect(dialog.querySelector("input[name=name]")).toHaveValue("Barba");
  });

  it("abrir o menu ⋮ não abre a edição", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: "Mais opções para Corte masculino" }));
    await screen.findByRole("menuitem", { name: "Duplicar" });
    expect(screen.queryByRole("dialog", { name: "Editar serviço" })).toBeNull();
  });

  it("sem permissão para gerenciar, a linha não abre nada e não vira botão", async () => {
    const user = userEvent.setup();
    mount(false);

    expect(screen.queryByRole("button", { name: /^Editar / })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mais opções para/ })).toBeNull();
    await user.click(screen.getByText("Corte masculino"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fecha a edição e devolve o foco ao ponto de partida", async () => {
    const user = userEvent.setup();
    mount();

    const row = screen.getByRole("button", { name: "Editar Corte masculino" });
    await user.click(row);
    await screen.findByRole("dialog", { name: "Editar serviço" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });
});
