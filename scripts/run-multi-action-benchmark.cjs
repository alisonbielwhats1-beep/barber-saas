const os = require("node:os");
try { os.userInfo(); } catch { os.userInfo = () => ({ username: "offline-evaluation" }); }
require("@next/env").loadEnvConfig(process.cwd(), true);
require("tsx/cjs");
require("./run-multi-action-benchmark.ts");
