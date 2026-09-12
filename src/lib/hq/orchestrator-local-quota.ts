import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rmdir } from "node:fs/promises";
import path from "node:path";

// Development-only usage metadata, never messages/results/credentials. Persists
// through HMR/restarts. Atomic lock also covers two local server processes.
export async function reserveLocalOrchestratorAttempt(project: string, actor: string, limit: number, directory = path.join(process.cwd(), ".demo", "orchestrator-usage")) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const prefix = path.join(directory, hash(project));
  const lock = `${prefix}.lock`;
  let locked = false;
  try {
    await mkdir(directory, { recursive: true });
    await mkdir(lock); locked = true;
    let entries: { at: number; actor: string }[] = [];
    try { entries = JSON.parse(await readFile(`${prefix}.json`, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!Array.isArray(entries) || entries.some(entry => !Number.isFinite(entry.at) || typeof entry.actor !== "string")) throw new Error("Invalid quota");
    const now = Date.now();
    entries = entries.filter(entry => entry.at > now - 86400000);
    if (entries.length >= limit) return "daily" as const;
    if (entries.some(entry => entry.actor === hash(actor) && entry.at > now - 60000)) return "minute" as const;
    entries.push({ at: now, actor: hash(actor) });
    await writeFile(`${prefix}.tmp`, JSON.stringify(entries), { mode: 0o600 });
    await rename(`${prefix}.tmp`, `${prefix}.json`);
    return "reserved" as const;
  } catch { return "unavailable" as const; }
  finally { if (locked) await rmdir(lock).catch(() => undefined); }
}
