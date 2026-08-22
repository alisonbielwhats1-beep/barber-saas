// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewDialog } from "./review-dialog";

const mocks = vi.hoisted(() => ({
  submitClientReview: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("../reviews-actions", () => ({
  submitClientReview: mocks.submitClientReview,
}));

describe("ReviewDialog", () => {
  beforeEach(() => {
    mocks.submitClientReview.mockReset();
    mocks.refresh.mockReset();
  });

  afterEach(() => cleanup());

  it("não permite publicar sem selecionar uma nota", async () => {
    const user = userEvent.setup();
    render(<ReviewDialog salonSlug="studio-a" appointmentId="appt-1" serviceName="Corte" />);

    await user.click(screen.getByRole("button", { name: "Avaliar atendimento" }));

    expect(screen.getByRole("button", { name: "Publicar avaliação" })).toBeDisabled();
    expect(mocks.submitClientReview).not.toHaveBeenCalled();
  });

  it("envia nota e comentário do atendimento concluído", async () => {
    mocks.submitClientReview.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ReviewDialog salonSlug="studio-a" appointmentId="appt-1" serviceName="Corte" />);

    await user.click(screen.getByRole("button", { name: "Avaliar atendimento" }));
    await user.click(screen.getByRole("radio", { name: "5 estrelas" }));
    await user.type(screen.getByLabelText(/Comentário/), "Excelente atendimento");
    await user.click(screen.getByRole("button", { name: "Publicar avaliação" }));

    await waitFor(() => expect(mocks.submitClientReview).toHaveBeenCalledWith(
      "studio-a",
      { appointmentId: "appt-1", rating: 5, comment: "Excelente atendimento" },
    ));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
