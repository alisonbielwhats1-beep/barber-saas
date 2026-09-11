import { beforeEach, expect, it, vi } from "vitest";
const access = vi.hoisted(() => vi.fn());
const runner = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hq/access", () => ({ withHq: access }));
vi.mock("@everflare/agents", () => ({ runLabScenario: runner }));
import { simulateAgent } from "./actions";

beforeEach(() => vi.resetAllMocks());
it("a ação preserva o bloqueio de autenticação e nunca executa SDK antes dele", async () => {
  access.mockRejectedValue(new Error("redirect-login"));
  await expect(simulateAgent("overview")).rejects.toThrow("redirect-login");
  expect(runner).not.toHaveBeenCalled();
});
it("executa fora da transação e não expõe detalhes do erro", async () => {
  let inTransaction = false;
  access.mockImplementation(async callback => {
    inTransaction = true; await callback(); inTransaction = false;
  });
  runner.mockImplementation(() => {
    expect(inTransaction).toBe(false);
    throw new Error("internal-secret");
  });
  expect(await simulateAgent("invalid")).toEqual({ ok: false, error: "Cenário inválido. Escolha uma das opções do laboratório." });
});
