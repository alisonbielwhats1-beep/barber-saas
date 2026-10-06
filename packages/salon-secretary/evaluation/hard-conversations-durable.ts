/** Evaluation-only append/fsync journal. Never supplies data to the Secretary. */
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

const Clock = Date; // Independent from the synthetic domain clock.
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const RESUME_SCOPE = "PHASE_A_RESUME_FROM_I12" as const;
export const RESUME_IDS = ["i12", "i14", "i15", "a02", "a04", "a09", "d09", "t07", "t08", "m02", "m03", "m05", "m07", "x01", "x02"] as const;
export const FINAL_CONTINUATION_SCOPE = "PHASE_A_CONTINUE_AFTER_INCONCLUSIVE_I12" as const;
export const FINAL_CONTINUATION_IDS: readonly string[] = RESUME_IDS.slice(1);
export type Checkpoint = "NOT_STARTED" | "STARTED" | "MODEL_COMPLETED" | "OBSERVATION_COMPLETED" | "CASE_COMPLETED" | "INCONCLUSIVE";
export type DurableKind = "STARTED" | "TURN_STARTED" | "BEFORE_NETWORK" | "AFTER_NETWORK" | "MODEL_COMPLETED" |
  "MODEL_FAILED" | "OBSERVATION_EVENT" | "OBSERVATION_COMPLETED" | "TURN_COMPLETED" | "CASE_COMPLETED" | "INCONCLUSIVE" | "STOPPED";
const kinds: DurableKind[] = ["STARTED", "TURN_STARTED", "BEFORE_NETWORK", "AFTER_NETWORK", "MODEL_COMPLETED",
  "MODEL_FAILED", "OBSERVATION_EVENT", "OBSERVATION_COMPLETED", "TURN_COMPLETED", "CASE_COMPLETED", "INCONCLUSIVE", "STOPPED"];
export type DurableRow = { seq: number; previous: string; binding: string; timestamp: string; kind: DurableKind;
  case_id: string | null; turn_index: number | null; attempt: number | null; data: unknown; hash: string };
export const durableFail = (code: string): never => { throw Error(`PHASE_A_DURABLE_${code}`); };

/** Defense in depth: raw payloads/headers and secret-shaped values are not journalable. */
export function sanitizeDurable(value: unknown, forbidden: readonly string[] = []): unknown {
  if (typeof value === "string") {
    if (/sk-(?:proj-)?[\w-]{10,}|Bearer\s+\S+|postgres(?:ql)?:\/\//i.test(value) ||
      forbidden.filter(v => v.length >= 4).some(v => value.includes(v))) durableFail("SECRET");
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) durableFail("NUMBER"); return value; }
  if (Array.isArray(value)) return value.map(v => sanitizeDurable(v, forbidden));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => {
    if (/^(authorization|api_?key|headers|raw.*|connection_string|request_body|response_body)$/i.test(k)) durableFail("FORBIDDEN_FIELD");
    return [k, sanitizeDurable(v, forbidden)];
  }));
  durableFail("SHAPE");
}

export function readDurable(file: string, binding: string): DurableRow[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  if (text && !text.endsWith("\n")) durableFail("TRUNCATED_JOURNAL");
  let previous = "0".repeat(64);
  return text.split("\n").filter(Boolean).map((line, index) => {
    let row: DurableRow;
    try { row = JSON.parse(line) as DurableRow; } catch { return durableFail("CORRUPT_JOURNAL"); }
    const { hash, ...body } = row;
    if (row.seq !== index + 1 || row.previous !== previous || row.binding !== binding ||
      !kinds.includes(row.kind) || digest(JSON.stringify(body)) !== hash) durableFail("HASH_MISMATCH");
    previous = hash;
    return row;
  });
}

export function checkpoint(rows: readonly DurableRow[], caseId: string): Checkpoint {
  const own = rows.filter(r => r.case_id === caseId);
  if (!own.length) return "NOT_STARTED";
  const latest = own.at(-1)!;
  if (latest.kind === "CASE_COMPLETED") return "CASE_COMPLETED";
  if (own.some(r => r.kind === "INCONCLUSIVE")) return "INCONCLUSIVE";
  if (own.some(r => r.kind === "OBSERVATION_COMPLETED")) return "OBSERVATION_COMPLETED";
  if (own.some(r => r.kind === "MODEL_COMPLETED")) return "MODEL_COMPLETED";
  return "STARTED";
}

/** A fresh process never reconstructs a live conversation from partial logs. */
export function resumeCursor(rows: readonly DurableRow[], ids: readonly string[] = RESUME_IDS,
  allowNetworkInconclusive = false,
  allowedInconclusiveReasons: readonly string[] = ["NETWORK"]): string[] {
  if (rows.some(r => r.kind === "STOPPED")) durableFail("STOP_REQUIRES_REVIEW");
  let pending = false;
  for (const id of ids) {
    const state = checkpoint(rows, id);
    const networkInconclusive = allowNetworkInconclusive && state === "INCONCLUSIVE" &&
      rows.findLast(r => r.case_id === id && r.kind === "INCONCLUSIVE")?.data &&
      allowedInconclusiveReasons.includes((rows.findLast(r => r.case_id === id &&
        r.kind === "INCONCLUSIVE")!.data as { reason?: string }).reason ?? "");
    if (state !== "NOT_STARTED" && state !== "CASE_COMPLETED" && !networkInconclusive)
      durableFail("INCONCLUSIVE_REQUIRES_AUTHORIZATION");
    if (state === "NOT_STARTED") pending = true;
    else if (pending) durableFail("CURSOR_ORDER");
  }
  return ids.filter(id => checkpoint(rows, id) === "NOT_STARTED");
}

export class DurableJournal {
  readonly rows: DurableRow[];
  private fd = -1;
  private lock: number;
  private poisoned = false;
  constructor(readonly file: string, readonly binding: string, private forbidden: readonly string[] = [],
    private readonly scope: { ids: readonly string[]; maxRequests: number; allowNetworkInconclusive: boolean;
      turnCounts?: Readonly<Record<string, number>>; allowedInconclusiveReasons?: readonly string[] } =
      { ids: RESUME_IDS, maxRequests: 17, allowNetworkInconclusive: false }) {
    if (!scope.ids.length || new Set(scope.ids).size !== scope.ids.length || !Number.isSafeInteger(scope.maxRequests) ||
      scope.maxRequests < 1 || scope.turnCounts && (Object.keys(scope.turnCounts).length !== scope.ids.length ||
      scope.ids.some(id => !Number.isSafeInteger(scope.turnCounts![id]) || scope.turnCounts![id] < 1)))
      durableFail("SCOPE_INVALID");
    // A live or unidentifiable lock is never stolen. Stale PID only after ESRCH.
    if (existsSync(file + ".lock")) {
      let pid: number;
      try { pid = JSON.parse(readFileSync(file + ".lock", "utf8")).pid; } catch { durableFail("LOCK_UNKNOWN"); }
      if (!Number.isSafeInteger(pid!) || pid! < 1) durableFail("LOCK_UNKNOWN");
      try { process.kill(pid!, 0); durableFail("LOCK_ACTIVE"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      unlinkSync(file + ".lock");
    }
    this.lock = openSync(file + ".lock", "wx", 0o600);
    try {
      writeSync(this.lock, JSON.stringify({ pid: process.pid })); fsyncSync(this.lock);
      this.rows = readDurable(file, binding);
      this.fd = openSync(file, "a", 0o600); fsyncSync(this.fd);
      for (const id of this.scope.ids) {
        const state = checkpoint(this.rows, id);
        if (!["NOT_STARTED", "CASE_COMPLETED", "INCONCLUSIVE"].includes(state))
          this.append("INCONCLUSIVE", id, this.rows.findLast(r => r.case_id === id)?.turn_index ?? null,
            { reason: "PROCESS_RESTART_WITHOUT_CASE_COMPLETED", last_durable_state: state });
      }
    } catch (error) { if (this.fd >= 0) closeSync(this.fd); closeSync(this.lock); unlinkSync(file + ".lock"); throw error; }
  }
  private requiredTurns(caseId: string) {
    return this.scope.turnCounts?.[caseId] ?? (caseId === "t07" || caseId === "t08" ? 2 : 1);
  }
  append(kind: DurableKind, caseId: string | null, turn: number | null, data: unknown = null) {
    if (this.poisoned) durableFail("WRITE_FAILED");
    if (!kinds.includes(kind) || (kind !== "STOPPED" && !caseId)) durableFail("EVENT_SHAPE");
    if (caseId && !this.scope.ids.includes(caseId)) durableFail("CASE_FORBIDDEN");
    if (turn !== null && (!caseId || !Number.isSafeInteger(turn) || turn < 1 ||
      turn > this.requiredTurns(caseId))) durableFail("TURN_FORBIDDEN");
    if (caseId && checkpoint(this.rows, caseId) === "CASE_COMPLETED") durableFail("CASE_IMMUTABLE");
    if (kind === "STARTED" && caseId && checkpoint(this.rows, caseId) !== "NOT_STARTED") durableFail("REPLAY_FORBIDDEN");
    if (caseId && kind !== "STARTED" && !this.rows.some(r => r.case_id === caseId && r.kind === "STARTED")) durableFail("START_REQUIRED");
    if (caseId && checkpoint(this.rows, caseId) === "INCONCLUSIVE") durableFail("INCONCLUSIVE_REQUIRES_AUTHORIZATION");
    if (kind === "STARTED" && this.scope.ids.slice(0, this.scope.ids.indexOf(caseId!))
      .some(id => checkpoint(this.rows, id) !== "CASE_COMPLETED" &&
        !(this.scope.allowNetworkInconclusive && checkpoint(this.rows, id) === "INCONCLUSIVE" &&
          (this.scope.allowedInconclusiveReasons ?? ["NETWORK"]).includes(
            (this.rows.findLast(r => r.case_id === id && r.kind === "INCONCLUSIVE")?.data as
              { reason?: string })?.reason ?? ""))))
      durableFail("CURSOR_ORDER");
    const ownTurn = this.rows.filter(r => r.case_id === caseId && r.turn_index === turn);
    if (kind === "TURN_STARTED" && (ownTurn.some(r => r.kind === "TURN_STARTED") ||
      (turn !== null && turn > 1 && !this.rows.some(r => r.case_id === caseId &&
        r.turn_index === turn - 1 && r.kind === "TURN_COMPLETED")))) durableFail("TURN_REPLAY_OR_ORDER");
    if (kind === "BEFORE_NETWORK" && !ownTurn.some(r => r.kind === "TURN_STARTED")) durableFail("TURN_REQUIRED");
    if (kind === "MODEL_COMPLETED" && !ownTurn.some(r => r.kind === "BEFORE_NETWORK")) durableFail("WIRE_REQUIRED");
    if (kind === "TURN_COMPLETED" && !ownTurn.some(r => r.kind === "OBSERVATION_COMPLETED")) durableFail("OBSERVATION_REQUIRED");
    if (kind === "CASE_COMPLETED") {
      const required = this.requiredTurns(caseId!);
      const completed = this.rows.filter(r => r.case_id === caseId && r.kind === "TURN_COMPLETED");
      if (completed.length !== required || completed.some((r, i) => r.turn_index !== i + 1)) durableFail("TURNS_INCOMPLETE");
    }
    if (kind === "BEFORE_NETWORK" && this.rows.some(r => r.kind === kind && r.case_id === caseId && r.turn_index === turn)) durableFail("RETRY_FORBIDDEN");
    if (kind === "BEFORE_NETWORK" && this.rows.filter(r => r.kind === kind).length >= this.scope.maxRequests) durableFail("BUDGET");
    const body = { seq: this.rows.length + 1, previous: this.rows.at(-1)?.hash ?? "0".repeat(64), binding: this.binding,
      timestamp: new Clock().toISOString(), kind, case_id: caseId, turn_index: turn,
      attempt: caseId ? caseId === "i12" ? 2 : 1 : null, data: sanitizeDurable(data, this.forbidden) };
    const row = { ...body, hash: digest(JSON.stringify(body)) };
    try {
      const bytes = Buffer.from(JSON.stringify(row) + "\n");
      let offset = 0;
      while (offset < bytes.length) { const n = writeSync(this.fd, bytes, offset, bytes.length - offset); if (!n) durableFail("WRITE_FAILED"); offset += n; }
      fsyncSync(this.fd); // Persist before granting permission to advance or reach the network.
      this.rows.push(row);
    } catch (error) { this.poisoned = true; throw error; }
    return row;
  }
  close() { closeSync(this.fd); closeSync(this.lock); unlinkSync(this.file + ".lock"); }
}
