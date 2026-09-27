/** Fail closed after the user-mandated stop. Executed source is preserved with evidence. */
console.error('STOPPED: local grant rollback required recovery. See docs/SECRETARY_FRONT_VOICE_LOCAL_GRANTS_RESULT.md. No SQL or E2E is executed by this entry point.');
process.exitCode = 1;
