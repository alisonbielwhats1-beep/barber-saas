'use strict';
// Local-only launcher of the model contract version CLI (see secretary-contract-version.ts): loads no .env file, touches
// no database and no network; --write rewrites only packages/salon-secretary/contract-version.json (coordinator only).
require('tsx/cjs');
require('./secretary-contract-version.ts');
