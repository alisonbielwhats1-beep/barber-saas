import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

describe("primeiro acesso da equipe", () => {
  it("nenhum fluxo de produção ou provisionamento usa senha fixa legada", () => {
    const roots = [join(process.cwd(), "src"), join(process.cwd(), "scripts")];
    const occurrences = roots
      .flatMap(sourceFiles)
      .filter((file) => readFileSync(file, "utf8").includes("trocar-agora"));

    expect(occurrences).toEqual([]);
  });
});
