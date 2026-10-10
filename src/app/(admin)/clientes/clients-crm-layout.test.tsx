// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientRow } from "@/lib/crm";
const actions = vi.hoisted(() => ({ fetchClientHistory: vi.fn(), createClient: vi.fn(), updateClient: vi.fn(), deleteClient: vi.fn(), restoreClient: vi.fn(), importClientsCsv: vi.fn(), mergeClients: vi.fn(), redeemLoyaltyReward: vi.fn() }));
vi.mock("./actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { ClientsCrm } from "./clients-crm";

const base: ClientRow = { id: "a", name: "Ana Souza", phone: "(11) 91234-5678", email: null, accountStatus: "guest", gender: null, genderDisplay: null, genderSource: null, notes: "", allergies: "", preferences: "", consentGiven: false, birthday: null, createdAt: "2026-01-01T12:00:00Z", visits: 3, totalSpent: 24000, avgTicket: 8000, lastVisit: null, daysSince: 2, favoritePro: null, favoriteService: null, loyaltyTier: "Bronze", loyaltyColor: "#94A3B8", loyaltyPoints: 3, loyaltyEarnedPoints: 3, loyaltyRedeemedPoints: 0, canRedeemLoyaltyReward: false, nextLoyaltyTier: "Prata", loyaltyRemaining: 2, loyaltyProgressPct: 60, activePackages: 0, activeSubscriptions: 0, upcomingCount: 0, nextAppointmentAt: "", isVip: false, isLapsed: false, birthdayThisMonth: false, possibleDuplicates: [] };
const clients: ClientRow[] = [base, { ...base, id: "b", name: "Bruna Lima", phone: "(11) 98888-7777" }];

/** The profile shares the screen with the list from 1024px (the query used by the client directory). */
function viewport(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop && query === "(min-width: 1024px)", media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}
function setup() {
  render(<ClientsCrm clients={clients} salonName="Teste" timezone="America/Sao_Paulo" canManage canDelete lapsedClientDays={60} />);
}
const profileTitle = (name: RegExp) => screen.queryByRole("heading", { level: 2, name });

beforeEach(() => { actions.fetchClientHistory.mockResolvedValue([]); actions.deleteClient.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.clearAllMocks(); Reflect.deleteProperty(window, "matchMedia"); });

it("computer: opens the first client's profile beside the list and switches without a window", async () => {
  viewport(true);
  setup();
  await waitFor(() => expect(profileTitle(/^Ana Souza/)).toBeInTheDocument());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const list = screen.getByLabelText("Lista de clientes");
  expect(within(list).getAllByRole("button", { current: true })).toHaveLength(1);
  fireEvent.click(within(list).getByRole("button", { name: /^Bruna Lima/ }));
  await waitFor(() => expect(profileTitle(/^Bruna Lima/)).toBeInTheDocument());
  expect(actions.fetchClientHistory).toHaveBeenLastCalledWith("b");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("computer: removing from the list asks first, keeps the profile until confirmed and calls the action once", async () => {
  viewport(true);
  setup();
  await waitFor(() => expect(profileTitle(/^Ana Souza/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Mais ações do cliente" }));
  fireEvent.click(await screen.findByRole("button", { name: "Excluir da lista" }));
  const confirm = await screen.findByRole("dialog", { name: "Excluir cliente da lista?" });
  expect(actions.deleteClient).not.toHaveBeenCalled();
  // Still beside the list (only hidden from assistive technology while the confirmation is modal).
  expect(screen.getByRole("heading", { level: 2, name: /^Ana Souza/, hidden: true })).toBeInTheDocument();
  fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar exclusão da lista" }));
  await waitFor(() => expect(actions.deleteClient).toHaveBeenCalledExactlyOnceWith("a"));
});

it("phone: the profile is a window and its menu leads to the same confirmation", async () => {
  viewport(false);
  setup();
  expect(profileTitle(/^Ana Souza/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ver detalhes de Ana Souza" }));
  const sheet = await screen.findByRole("dialog");
  expect(within(sheet).getByRole("heading", { level: 2, name: /^Ana Souza/ })).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Mais ações do cliente" }));
  fireEvent.click(await screen.findByRole("button", { name: "Excluir da lista" }));
  await screen.findByRole("dialog", { name: "Excluir cliente da lista?" });
  expect(screen.queryByRole("button", { name: "Mais ações do cliente" })).not.toBeInTheDocument();
  expect(actions.deleteClient).not.toHaveBeenCalled();
});

it("shows the groups as pressed buttons and filters the list", () => {
  viewport(false);
  render(<ClientsCrm clients={[{ ...base, isVip: true }, { ...clients[1] }]} salonName="Teste" timezone="America/Sao_Paulo" canManage={false} lapsedClientDays={60} />);
  const groups = screen.getByRole("group", { name: "Grupos de clientes" });
  expect(within(groups).getByRole("button", { name: "Todos" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(groups).getByRole("button", { name: "VIP · 1" }));
  const list = screen.getByLabelText("Lista de clientes");
  expect(within(list).getByRole("button", { name: /^Ana Souza/ })).toBeInTheDocument();
  expect(within(list).queryByRole("button", { name: /^Bruna Lima/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mais opções de clientes" })).not.toBeInTheDocument();
});
