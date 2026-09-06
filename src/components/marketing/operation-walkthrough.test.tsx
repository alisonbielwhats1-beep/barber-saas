// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OperationWalkthrough } from "./operation-walkthrough";
afterEach(cleanup);
function Demo() { const [step,setStep] = useState(0); return <OperationWalkthrough step={step} onStep={setStep} />; }
it("separa conclusão de recebimento e permite reiniciar a rotina", () => {
  render(<Demo />);
  fireEvent.click(screen.getByRole("button", { name: "Concluir atendimento" }));
  expect(screen.getByRole("status")).toHaveTextContent("ainda não recebido");
  fireEvent.click(screen.getByRole("button", { name: "Registrar recebimento manual" }));
  expect(screen.getByRole("status")).toHaveTextContent("Pix · R$ 80,00");
  fireEvent.click(screen.getByRole("button", { name: "Conferir no financeiro" }));
  expect(screen.getByRole("status")).toHaveTextContent("comissão R$ 32,00");
  fireEvent.click(screen.getByRole("button", { name: "Recomeçar demonstração" }));
  expect(screen.getByRole("status")).toHaveTextContent("Reserva confirmada");
});
