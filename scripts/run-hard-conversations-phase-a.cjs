// Windows sandbox bootstrap only; the TypeScript entry performs all safety checks.
const os = require("node:os");
try { os.userInfo(); } catch { os.userInfo = () => ({ username: "offline-evaluation" }); }
require("@next/env").loadEnvConfig(process.cwd(), true);
require("tsx/cjs");
process.argv = [process.execPath, require.resolve("./run-hard-conversations-phase-a.ts"), ...process.argv.slice(2)];
require("./run-hard-conversations-phase-a.ts");
