import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("manifesto instalavel", () => {
  it("abre o painel em modo standalone com icone mascaravel", () => {
    const data = manifest();
    expect(data.start_url).toBe("/");
    expect(data.display).toBe("standalone");
    expect(data.lang).toBe("pt-BR");
    expect(data.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: "maskable" }),
      ]),
    );
  });
});
