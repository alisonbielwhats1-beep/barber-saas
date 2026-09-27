// Offline CLI bootstrap for Windows sandboxes where os.userInfo() is unavailable.
// No network, model, database or environment values are read beyond the OS account name.
const os = require("node:os");
try { os.userInfo(); } catch { os.userInfo = () => ({ username: "offline-evaluation" }); }
require("tsx/cjs");
process.argv = [process.execPath, require.resolve("./preflight-hard-conversations-phase-a.ts"), ...process.argv.slice(2)];
require("./preflight-hard-conversations-phase-a.ts");
