/** Process-local observer, installed by the targeted CLI before loading the runtime. */
let ms = 0, calls = 0;
export function recordComposer(duration: number) { ms += duration; calls++; }
export function composerMeasurement() { return { ms, calls }; }
