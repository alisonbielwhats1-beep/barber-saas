'use strict';
// Local-only launcher of the candidate freeze (see secretary-freeze-candidate.ts): loads no .env file, touches no
// database and no network; reads the working tree through local git plumbing and writes .demo/agenda-core/candidates/.
require('tsx/cjs');
require('./secretary-freeze-candidate.ts');
