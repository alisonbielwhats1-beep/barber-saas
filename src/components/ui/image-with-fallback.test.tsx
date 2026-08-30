// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageWithFallback } from "./image-with-fallback";

vi.mock("next/image", () => ({
  default: ({ fill, alt = "", ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={alt} data-fill={fill || undefined} />
  ),
}));

describe("ImageWithFallback", () => {
  it("troca URL remota quebrada por asset local preservando o texto alternativo", () => {
    render(
      <ImageWithFallback
        src="https://project.supabase.co/storage/v1/object/public/salon-assets/salon-a/logo.webp"
        fallbackSrc="/images/salon-hero-barber-v2.webp"
        alt="Logo do salão"
        fill
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Logo do salão" }));

    expect(screen.getByRole("img", { name: "Logo do salão" })).toHaveAttribute(
      "src",
      "/images/salon-hero-barber-v2.webp",
    );
  });

  it("pode substituir avatar quebrado por iniciais", () => {
    render(
      <ImageWithFallback
        src="https://example.invalid/avatar.webp"
        fallback={<span aria-label="Iniciais de Ana">AS</span>}
        alt="Foto de Ana"
        width={48}
        height={48}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Foto de Ana" }));
    expect(screen.getByLabelText("Iniciais de Ana")).toHaveTextContent("AS");
  });
});
