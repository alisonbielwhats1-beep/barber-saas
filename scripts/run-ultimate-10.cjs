// Windows sandbox bootstrap; all safety checks remain in the TypeScript CLI.
const os = require("node:os");
try { os.userInfo(); } catch { os.userInfo = () => ({ username: "offline-evaluation" }); }
require("@next/env").loadEnvConfig(process.cwd(), true);
require("tsx/cjs");
process.argv = [process.execPath, require.resolve("./run-ultimate-10.ts"), ...process.argv.slice(2)];
require("./run-ultimate-10.ts");
