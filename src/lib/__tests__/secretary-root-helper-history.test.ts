import { createHash } from "node:crypto";
import * as actual from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frontHistoricalFs } from "../../test/secretary-front-history";
import { legacyEvidenceFs } from "../../test/secretary-legacy-evidence";
import { protectExisting, verifyFrozenTarget, verifyPrior } from "../../../packages/salon-secretary/evaluation/x94-original-target";

const sources = ["src/lib/customer-catalog.ts", "src/lib/scheduling-entity-mentions.ts"];
const archives = [
  { file: "src/test/fixtures/secretary-front-predecessor.json", manifest: "packages/salon-secretary/evaluation/results/topic14-final/real-manifest.json", key: "source_hashes", reader: frontHistoricalFs, error: "INVALID_PRE_FRONT_ARCHIVE" },
  { file: "src/test/fixtures/secretary-v1-frozen-sources.json", manifest: "packages/salon-secretary/evaluation/hard-conversations-plan.json", key: "predecessors", reader: legacyEvidenceFs, error: "INVALID_LEGACY_SOURCE_ARCHIVE" },
];
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
afterEach(() => vi.unstubAllGlobals());

describe("historical source bytes remain separate from current backend authorization", () => {
  for (const archive of archives) {
    for (const source of sources) {
      it(`${archive.file} serves the sealed original ${source}`, () => {
        const expected = JSON.parse(actual.readFileSync(archive.manifest, "utf8"))[archive.key][source];
        const read = archive.reader(actual);
        expect(sha(read(source))).toBe(expected);
        expect(sha(read(path.resolve(source), "utf8"))).toBe(expected);
        expect(sha(actual.readFileSync(source))).not.toBe(expected);
      });
      it(`${archive.file} rejects one changed source byte in ${source}`, () => {
        const changed = JSON.parse(actual.readFileSync(archive.file, "utf8"));
        changed[source] += " ";
        const read = ((file: Parameters<typeof actual.readFileSync>[0], options?: Parameters<typeof actual.readFileSync>[1]) =>
          String(file).replaceAll("\\", "/").endsWith(archive.file) ? JSON.stringify(changed) : actual.readFileSync(file, options)) as typeof actual.readFileSync;
        expect(() => archive.reader({ ...actual, readFileSync: read })).toThrow(archive.error);
      });
    }
    it(`${archive.file} cannot add an unsealed source to the historical reader`, () => {
      const changed = JSON.parse(actual.readFileSync(archive.file, "utf8"));
      changed["src/lib/unsealed-history-source.ts"] = "not part of the historical authorization";
      const read = ((file: Parameters<typeof actual.readFileSync>[0], options?: Parameters<typeof actual.readFileSync>[1]) =>
        String(file).replaceAll("\\", "/").endsWith(archive.file) ? JSON.stringify(changed) : actual.readFileSync(file, options)) as typeof actual.readFileSync;
      expect(() => archive.reader({ ...actual, readFileSync: read })).toThrow(archive.error);
    });
  }

  it("real reads still reject the old X94 authorization before database or network access", async () => {
    const database = vi.fn(() => { throw Error("DATABASE_FORBIDDEN"); });
    const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
    vi.stubGlobal("fetch", network);
    const admin = new Proxy({} as Parameters<typeof protectExisting>[0], { get: database });
    expect(() => verifyPrior()).toThrow("X94_UNAUTHORIZED_SOURCE_DRIFT");
    expect(() => verifyFrozenTarget()).toThrow("X94_UNAUTHORIZED_SOURCE_DRIFT");
    await expect(protectExisting(admin)).rejects.toThrow("X94_UNAUTHORIZED_SOURCE_DRIFT");
    expect(database).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
});
