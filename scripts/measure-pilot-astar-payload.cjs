'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS launcher: it loads tsx before requiring the TypeScript harness */
// A* premise probe, spec 13 §4.4 and §9.4 (offline, no credential), INFORMATIVE only: the full-flow construction of the E2-B payload proof (300
// services, 40 team names, the worst documented text of 1000 accented characters, every repair rule of the variant, the two worst open-plan shapes),
// with and without the repeated mencao descriptions, against the cost-guard cap (request bytes + 8192 <= 64000) and the 2048 B rule. The probe's gate
// is per case (each case's real request with the worst text, in its dry-run); this number is reported to the owner, never a gate. Prints one JSON object.
//   node scripts/measure-pilot-astar-payload.cjs
require('tsx/cjs');
const { astarPayloadMeasurement } = require('../packages/salon-secretary/evaluation/pilot-anchor-probe.ts');
const { PILOT_ASTAR_CONTRACT_SHA256 } = require('../packages/salon-secretary/src/pilot-astar-prompt.ts');
console.log(JSON.stringify({ ...astarPayloadMeasurement(), contractSha256: PILOT_ASTAR_CONTRACT_SHA256 }, null, 2));
