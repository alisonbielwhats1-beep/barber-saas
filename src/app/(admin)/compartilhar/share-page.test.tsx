// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharePage } from "./share-page";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ toast: toastMock }));

afterEach(() => {
  cleanup();
  toastMock.mockReset();
  Reflect.deleteProperty(navigator, "clipboard");
});

function setClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true });
}

describe("SharePage", () => {
  it("usa o mesmo domínio oficial no QR Code, link e mensagem de divulgação", () => {
    const bookingUrl = "https://everflair.com.br/book/luna-hair";
    render(
      <SharePage
        salon={{ name: "Luna Hair", slug: "luna-hair", plan: "FREE", phone: null }}
        bookingUrl={bookingUrl}
      />,
    );

    expect(screen.getByRole("link", { name: "Ver página" })).toHaveAttribute("href", bookingUrl);
    const qr = screen.getByRole("img", { name: "QR Code — Luna Hair" });
    expect(new URL(qr.getAttribute("src")!).searchParams.get("data")).toBe(bookingUrl);
    for (const whatsapp of screen.getAllByRole("link", { name: "Abrir WhatsApp" })) {
      expect(new URL(whatsapp.getAttribute("href")!).searchParams.get("text")).toContain(bookingUrl);
    }
  });

  it("copia o link e confirma quando a área de transferência aceita", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(
      <SharePage
        salon={{ name: "Luna Hair", slug: "luna-hair", plan: "FREE", phone: null }}
        bookingUrl="https://example.com/book/luna-hair"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    await screen.findByRole("button", { name: "Copiado!" });
    expect(writeText).toHaveBeenCalledWith("https://example.com/book/luna-hair");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("avisa com mensagem amigável quando a cópia é recusada, sem marcar como copiado", async () => {
    setClipboard(vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")));
    render(
      <SharePage
        salon={{ name: "Luna Hair", slug: "luna-hair", plan: "FREE", phone: null }}
        bookingUrl="https://example.com/book/luna-hair"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(2));
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("Não foi possível copiar"), "error");
    expect(screen.queryByText("Copiado!")).toBeNull();
  });

  it("não quebra quando o navegador nem expõe a área de transferência", async () => {
    setClipboard(undefined);
    render(
      <SharePage
        salon={{ name: "Luna Hair", slug: "luna-hair", plan: "FREE", phone: null }}
        bookingUrl="https://example.com/book/luna-hair"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("Não foi possível copiar"), "error"));
  });

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
