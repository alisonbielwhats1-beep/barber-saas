import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export type SecretaryTimingStage = "T1" | "T2" | "T3" | "T4";
const observations = new AsyncLocalStorage<(stage: SecretaryTimingStage, at: number) => void>();
/** Process-local observational hook; no provider payload or business state is changed. */
export function withSecretaryTiming<T>(observer: (stage: SecretaryTimingStage, at: number) => void, task: () => Promise<T>) {
  return observations.run(observer, task);
}
export function markSecretaryTiming(stage: SecretaryTimingStage) {
  observations.getStore()?.(stage, performance.now());
}
