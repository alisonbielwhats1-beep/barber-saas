'use strict';
// Local-only launcher of the holdout registry CLI (see secretary-holdout-registry.ts): loads no .env file, touches no
// database and no network; reads one scenario file and writes packages/salon-secretary/evaluation/holdout-registry.json.
require('tsx/cjs');
require('./secretary-holdout-registry.ts');
