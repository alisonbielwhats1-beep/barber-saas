// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SharePage } from "./share-page";

afterEach(cleanup);

describe("SharePage", () => {
  it("mantém as dicas secundárias recolhidas e sem emojis estruturais", () => {
    render(
      <SharePage
        salon={{ name: "Luna Hair", slug: "luna-hair", plan: "FREE", phone: null }}
        bookingUrl="https://example.com/book/luna-hair"
      />,
    );

    const tips = screen.getByText("Dicas de divulgação").closest("details");
    expect(tips).toBeInTheDocument();
    expect(tips).not.toHaveAttribute("open");
    expect(screen.getByText("Imprima o QR Code e coloque num porta-retrato na recepção")).toBeInTheDocument();
    expect(screen.getByText("Agendamento online · Luna Hair")).toBeInTheDocument();
  });
});
