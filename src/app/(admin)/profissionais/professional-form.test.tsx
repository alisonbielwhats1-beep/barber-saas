// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createProfessional: vi.fn(async () => ({ recipientEmail: "tatiana@example.com", deliveryStatus: "SENT" as const, expiresAt: "2026-09-14T12:00:00.000Z" })),
  updateProfessional: vi.fn(async () => undefined),
  setProfessionalServices: vi.fn(async () => undefined),
}));

vi.mock("./actions", () => actions);
vi.mock("@/components/ui/image-upload", () => ({
  ImageUpload: ({ onChange }: { onChange: (value: string) => void }) => <button type="button" onClick={() => onChange("https://example.com/profile.jpg")}>Selecionar foto</button>,
}));

import { ProfessionalForm } from "./professional-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfessionalForm", () => {
  it("cadastra foto, nome, sobrenome, e-mail e telefone no convite", async () => {
    render(<ProfessionalForm services={[]} invitesEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(screen.getByRole("heading", { name: "Novo profissional" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Selecionar foto" }));
    fireEvent.change(screen.getByLabelText(/Nome \*/), { target: { value: "Tatiana" } });
    fireEvent.change(screen.getByLabelText("Sobrenome"), { target: { value: "Medeiros" } });
    fireEvent.change(screen.getByLabelText(/E-mail \*/), { target: { value: "tatiana@example.com" } });
    fireEvent.change(screen.getByLabelText("Número de telefone"), { target: { value: "11912345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar convite" }));

    await waitFor(() => expect(actions.createProfessional).toHaveBeenCalledWith(expect.objectContaining({
      name: "Tatiana Medeiros",
      email: "tatiana@example.com",
      phone: "(11) 91234-5678",
      avatarUrl: "https://example.com/profile.jpg",
    })));
  });
});
