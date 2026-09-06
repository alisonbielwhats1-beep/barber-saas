// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EstablishmentShell } from "./establishment-shell";
import { SegmentPicker, useSegmentSelection } from "@/components/segment-service-picker";
import { SEGMENT_STORAGE_KEY } from "./segments";

vi.mock("next/image", () => ({ default: ({ src }: { src: string }) => <span data-testid="photo">{src}</span> }));
beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

function FormProbe() {
  const selection = useSegmentSelection();
  return <><input aria-label="Nome do espaço" /><SegmentPicker segmentId={selection.segmentId} onPick={selection.pickSegment} /><output data-testid="selected">{selection.segmentId}</output><output data-testid="services">{selection.serviceNames.join(", ")}</output></>;
}

it("troca a atmosfera junto com o segmento e preserva o nome digitado", () => {
  const { container } = render(<EstablishmentShell initialSegment="barbearia"><FormProbe /></EstablishmentShell>);
  const main = container.querySelector("main")!;
  fireEvent.change(screen.getByLabelText("Nome do espaço"), { target: { value: "Meu espaço" } });
  expect(main.dataset.atmosphere).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "Manicure" }));
  expect(main.dataset.segment).toBe("manicure");
  expect(main.dataset.atmosphere).toBe("light");
  expect(screen.getByTestId("photo").textContent).toContain("brand-manicure");
  expect(screen.getByTestId("selected").textContent).toBe("manicure-nail");
  expect(screen.getByTestId("services").textContent).not.toContain("Barba");
  expect(screen.getByLabelText("Nome do espaço")).toHaveValue("Meu espaço");
  expect(sessionStorage.getItem(SEGMENT_STORAGE_KEY)).toBe("manicure");
  fireEvent.click(screen.getByRole("button", { name: "Misto" }));
  expect(main.dataset.segment).toBe("espaco-misto");
  fireEvent.click(screen.getByRole("button", { name: "Barbearia" }));
  expect(main.dataset.atmosphere).toBe("dark");
});

it("mantém a preferência de massagem e aplica a mesma sincronização no onboarding", () => {
  sessionStorage.setItem(SEGMENT_STORAGE_KEY, "bem-estar");
  const { container } = render(<EstablishmentShell onboarding><FormProbe /></EstablishmentShell>);
  expect(container.querySelector("main")!.dataset.segment).toBe("bem-estar");
  expect(screen.getByTestId("selected").textContent).toBe("estetica-bemestar");
  fireEvent.click(screen.getByRole("button", { name: "Salão" }));
  expect(container.querySelector("main")!.dataset.segment).toBe("salao");
  expect(screen.getByTestId("selected").textContent).toBe("salao-beleza");
});
