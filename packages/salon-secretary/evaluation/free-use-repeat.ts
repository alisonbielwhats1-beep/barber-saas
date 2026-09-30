/** Golden/holdout pass^k: K independent identity sets under ONE approved binding. Pure; no DB, network or journal. */
import type { CaseStatus } from './free-use-contract';
import { freeUseBindingMaxRequests } from './free-use-budget';
// Routine k=5, release k=8 (docs/SECRETARY_RELIABILITY_ARCHITECTURE.md).
export const FREE_USE_MAX_REPEAT = 8;
// One attempt never admits more than a single pass did before repeat existed.
export const FREE_USE_ATTEMPT_MAX_REQUESTS = 500;
export function freeUseRepeat(value: unknown = 1) {
  const repeat = typeof value === 'string' && /^[1-9][0-9]?$/.test(value) ? Number(value) : value;
  if (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1 || repeat > FREE_USE_MAX_REPEAT) throw Error('FREE_USE_REPEAT');
  return repeat;
}
export const attemptNamespace = (namespace: string, attempt: number) => namespace + '-k' + attempt;
export const attemptDirectory = (attempt: number) => 'k' + attempt;
export const attemptCaseLabel = (caseId: string, attempt: number) => caseId + '#k' + attempt;
/** `--max-requests` is per attempt; the single binding admits repeat x that, never above the mission's binding limit. */
export function freeUseRequestLimit(perAttempt: number, repeat: number, mission: string) {
  const bindingMax = freeUseBindingMaxRequests(mission), total = perAttempt * freeUseRepeat(repeat);
  if (!Number.isInteger(perAttempt) || perAttempt < 1 || perAttempt > FREE_USE_ATTEMPT_MAX_REQUESTS || total > bindingMax) throw Error('FREE_USE_BUDGET_CONFIG');
  return total;
}
export function binomial(n: number, k: number) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) return 0;
  let value = 1; for (let i = 1; i <= k; i++) value = value * (n - k + i) / i;
  return Math.round(value);
}
export type AttemptOutcome = { attempt: number; cases: { id: string; family: string; status: CaseStatus }[] };
/** Per case: c PASS of n planned attempts, pass^k = C(c,k)/C(n,k) for k=1..n. Only PASS succeeds; FAIL is an
 * observed failure; BLOCKED, NOT_EXECUTED or a missing attempt is UNKNOWN: never PASS, and it nulls pass^k
 * (the lower bound treats it as failure). */
export function aggregatePassK(attempts: AttemptOutcome[], repeat: number) {
  const n = freeUseRepeat(repeat), ks = Array.from({ length: n }, (_, index) => index + 1);
  if (new Set(attempts.map(a => a.attempt)).size !== attempts.length || attempts.some(a => !ks.includes(a.attempt))) throw Error('FREE_USE_REPEAT');
  const order = [...new Map(attempts.slice().sort((a, b) => a.attempt - b.attempt).flatMap(a => a.cases.map(c => [c.id, c.family] as const))).entries()];
  const perCase = order.map(([id, family]) => {
    const statuses = ks.map(k => attempts.find(a => a.attempt === k)?.cases.find(c => c.id === id)?.status ?? 'NOT_EXECUTED');
    const c = statuses.filter(status => status === 'PASS').length, fail = statuses.filter(status => status === 'FAIL').length, unknown = n - c - fail;
    const lower = Object.fromEntries(ks.map(k => [k, binomial(c, k) / binomial(n, k)]));
    return { id, family, c, n, fail, unknown, statuses, passK: Object.fromEntries(ks.map(k => [k, unknown ? null : lower[k]])), passKLowerBound: lower };
  });
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const complete = perCase.length > 0 && perCase.every(c => c.unknown === 0);
  return { repeat: n, cases: perCase.length, complete, estimator: 'pass^k = C(c,k)/C(n,k) per case, mean over cases; UNKNOWN never counts as PASS',
    passK: Object.fromEntries(ks.map(k => [k, complete ? mean(perCase.map(c => c.passKLowerBound[k])) : null])),
    passKLowerBound: Object.fromEntries(ks.map(k => [k, mean(perCase.map(c => c.passKLowerBound[k]))])),
    allAttemptsPass: perCase.filter(c => c.c === n).map(c => c.id), flaky: perCase.filter(c => c.c > 0 && c.fail > 0).map(c => c.id),
    neverPass: perCase.filter(c => c.c === 0 && c.unknown === 0).map(c => c.id), unknown: perCase.filter(c => c.unknown > 0).map(c => c.id), perCase };
}
