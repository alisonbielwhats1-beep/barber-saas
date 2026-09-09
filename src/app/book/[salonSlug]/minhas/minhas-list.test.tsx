// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinhasList } from "./minhas-list";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("../auth-actions", () => ({ logoutClient: vi.fn() }));
vi.mock("./review-dialog", () => ({ ReviewDialog: () => null }));

function appointment({
  id,
  startAt,
  status,
  serviceName,
}: {
  id: string;
  startAt: string;
  status: string;
  serviceName: string;
}) {
  return {
    id,
    startAt,
    endAt: new Date(new Date(startAt).getTime() + 60 * 60 * 1_000).toISOString(),
    priceCents: 8000,
    status,
    version: 1,
    dependentName: null,
    _count: { waitlistEntries: 0 },
    service: { id: `service-${id}`, name: serviceName, colorHex: null },
    serviceItems: [],
    events: [{
      id: `event-${id}`,
      eventType: "CREATED",
      actorType: "CLIENT",
      actorName: "Cliente",
      reason: null,
      createdAt: startAt,
      previousStartAt: null,
      startAt,
    }],
    professional: { id: "professional-1", user: { name: "Tatiane" } },
    products: [],
    review: null,
  };
}

function mount(appointments: ReturnType<typeof appointment>[]) {
  render(
    <MinhasList
      appointments={appointments}
      pendingProposals={[]}
      waitlistEntries={[]}
      salonSlug="studio-martinelli"
      currency="BRL"
      timezone="America/Sao_Paulo"
      cancelPolicyHours={2}
      salonName="Studio Martinelli"
      salonAddress={null}
      session={{ clientId: "client-1", salonId: "salon-1", name: "Ana", email: "ana@example.test" }}
    />,
  );
}

describe("MinhasList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("separa próximos atendimentos do histórico", () => {
    mount([
      appointment({ id: "next", startAt: "2026-09-15T13:00:00Z", status: "CONFIRMED", serviceName: "Corte do dia 15" }),
      appointment({ id: "later", startAt: "2026-09-22T13:00:00Z", status: "CONFIRMED", serviceName: "Corte do dia 22" }),
      appointment({ id: "cancelled", startAt: "2026-09-08T13:00:00Z", status: "CANCELLED", serviceName: "Reserva cancelada" }),
    ]);

    expect(screen.getByRole("tab", { name: /Próximos 2/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Corte do dia 15")).toBeVisible();
    expect(screen.getByText("Corte do dia 22")).toBeVisible();
    expect(screen.queryByText("Reserva cancelada")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Histórico 1/ }));

    expect(screen.getByRole("tab", { name: /Histórico 1/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Reserva cancelada")).toBeVisible();
    expect(screen.queryByText("Corte do dia 15")).not.toBeInTheDocument();
    expect(screen.getByText("Reserva cancelada").closest("article")).toHaveAttribute("data-tone", "danger");
  });

  it("não apresenta uma reserva passada e sem fechamento como confirmação verde", () => {
    mount([
      appointment({ id: "past-confirmed", startAt: "2026-09-08T13:00:00Z", status: "CONFIRMED", serviceName: "Atendimento sem fechamento" }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: /Histórico 1/ }));

    expect(screen.getByText("Atendimento passado")).toBeVisible();
    expect(screen.getByText("Atendimento sem fechamento").closest("article")).toHaveAttribute("data-tone", "neutral");
  });
});
