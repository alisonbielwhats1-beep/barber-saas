// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  cancelProfessionalInvite: vi.fn(async () => undefined),
  resendProfessionalInvite: vi.fn(async () => ({ deliveryStatus: "SENT" as const })),
}));
const refresh = vi.hoisted(() => vi.fn());

vi.mock("./actions", () => actionMocks);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { PendingInvites } from "./pending-invites";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PendingInvites", () => {
  it("substitui a confirmação nativa ao cancelar um convite", async () => {
    render(
      <PendingInvites
        invites={[
          {
            id: "invite-1",
            name: "Camila Reis",
            email: "camila@example.com",
            role: "PROFESSIONAL",
            createdAt: "2026-08-20T12:00:00.000Z",
            sentAt: "2026-08-20T12:01:00.000Z",
            expiresAt: "2099-08-20T12:00:00.000Z",
            revokedAt: null,
            deliveryStatus: "SENT",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/O link deixará de funcionar imediatamente/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar convite" }));
    await waitFor(() => expect(actionMocks.cancelProfessionalInvite).toHaveBeenCalledWith("invite-1"));
  });
});
