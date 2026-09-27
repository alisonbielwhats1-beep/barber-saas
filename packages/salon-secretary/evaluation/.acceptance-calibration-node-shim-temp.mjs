// Local tsx CLI compatibility on this Windows host; no network or credentials.
process.geteuid ??= () => 1000;
