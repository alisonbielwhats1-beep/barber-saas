import path from "node:path";
import { createHash } from "node:crypto";

/** Test-only historical source archive. Never imported by runtime or live runners.
 * Only source-byte reads are redirected; module execution still uses the current
 * implementation. Functional V1-off/V2-on regression suites do NOT use this mock.
 * The archived bytes must match the immutable historical manifest, not new pins.
 */
export function legacyEvidenceFs(actual: typeof import("node:fs")): typeof actual.readFileSync {
  const root = process.cwd();
  const archive = JSON.parse(actual.readFileSync(path.join(root,
    "src/test/fixtures/secretary-v1-frozen-sources.json"), "utf8")) as Record<string, string>;
  const manifest = JSON.parse(actual.readFileSync(path.join(root,
    "packages/salon-secretary/evaluation/hard-conversations-plan.json"), "utf8")) as { predecessors: Record<string, string> };
  const sources = new Map<string, Buffer>();
  for (const [file, source] of Object.entries(archive)) {
    const bytes = Buffer.from(source, "utf8");
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.predecessors[file])
      throw Error(`INVALID_LEGACY_SOURCE_ARCHIVE:${file}`);
    sources.set(path.resolve(root, file), bytes);
  }
  return ((file: Parameters<typeof actual.readFileSync>[0], options?: unknown) => {
    const archived = typeof file === "string" ? sources.get(path.resolve(file)) : undefined;
    if (!archived) return actual.readFileSync(file, options as Parameters<typeof actual.readFileSync>[1]);
    const encoding = typeof options === "string" ? options :
      options && typeof options === "object" && "encoding" in options ? options.encoding : null;
    return encoding ? archived.toString(encoding as BufferEncoding) : Buffer.from(archived);
  }) as typeof actual.readFileSync;
}
