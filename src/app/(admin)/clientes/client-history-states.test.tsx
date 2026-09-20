// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ClientRow } from "@/lib/crm";
const history = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ fetchClientHistory: history, createClient: vi.fn(), updateClient: vi.fn(), deleteClient: vi.fn(), restoreClient: vi.fn(), importClientsCsv: vi.fn(), mergeClients: vi.fn(), redeemLoyaltyReward: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { ClientsCrm } from "./clients-crm";
const client: ClientRow = { id: "a", name: "João", phone: "(11) 91234-5678", email: null, accountStatus: "guest", gender: null, genderDisplay: null, genderSource: null, notes: "", allergies: "", preferences: "", consentGiven: false, birthday: null, createdAt: "2026-01-01T12:00:00Z", visits: 0, totalSpent: 0, avgTicket: 0, lastVisit: null, daysSince: null, favoritePro: null, favoriteService: null, loyaltyTier: "Novo", loyaltyColor: "#94A3B8", loyaltyPoints: 0, loyaltyEarnedPoints: 0, loyaltyRedeemedPoints: 0, canRedeemLoyaltyReward: false, nextLoyaltyTier: "Bronze", loyaltyRemaining: 0, loyaltyProgressPct: 0, activePackages: 0, activeSubscriptions: 0, upcomingCount: 0, nextAppointmentAt: "", isVip: false, isLapsed: false, birthdayThisMonth: false, possibleDuplicates: [] };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup() { render(<ClientsCrm clients={[client]} salonName="Teste" timezone="America/Sao_Paulo" canManage={false} lapsedClientDays={60} />); }
it("distinguishes loading, failure, retry and successful empty response", async () => {
  let reject!: (error: Error) => void;
  history.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce([]);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Ver detalhes de João" }));
  expect(screen.getByRole("status")).toHaveTextContent("Carregando");
  expect(screen.queryByText("Sem atendimentos registrados.")).not.toBeInTheDocument();
  await act(async () => reject(new Error("offline")));
  expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar");
  expect(screen.queryByText("Sem atendimentos registrados.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect(screen.getByText("Sem atendimentos registrados.")).toBeInTheDocument());
  expect(history).toHaveBeenCalledTimes(2);
});
it("searches names without accents and phones without requiring matching masks", () => {
  setup(); const search = screen.getByRole("textbox", { name: "Buscar cliente ou telefone" });
  for (const value of ["Joao", "11912345678", "(11) 91234-5678"]) {
    fireEvent.change(search, { target: { value } });
    expect(screen.getByRole("button", { name: "Ver detalhes de João" })).toBeInTheDocument();
  }
});
