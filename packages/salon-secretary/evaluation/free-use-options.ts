/** Free-use CLI/admission options: allowlisted arguments and the SALON_SECRETARY_* flag snapshot. Pure. */
import { freeUseMission } from './free-use-budget';
import { freeUseRepeat } from './free-use-repeat';
const PREFIX = 'SALON_SECRETARY_';
// Credentials and identifiers are never recorded (not even their names); matched after the prefix,
// because "SECRETARY" itself contains "SECRET". Only short enum-like values are snapshotted.
const CREDENTIAL = /(?:KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|BEARER|COOKIE|AUTH|PROJECT|ORG|ACTOR|USER|EMAIL|PHONE|URL|URI|DSN|WEBHOOK|(?:^|_)TOKEN(?:_|$))/;
const enumLike = (value: string) => /^(?:true|false|on|off|yes|no)$/i.test(value) || /^(?:[0-9]{1,6}|[a-z][a-z0-9._-]{0,47}|[A-Z][A-Z0-9_]{0,47})$/.test(value);
export function freeUseFlags(env: Record<string, string | undefined> = process.env) {
  const flags: Record<string, string> = {};
  for (const name of Object.keys(env).sort()) {
    const value = env[name];
    if (!/^SALON_SECRETARY_[A-Z0-9_]+$/.test(name) || CREDENTIAL.test(name.slice(PREFIX.length)) || typeof value !== 'string' || !enumLike(value)) continue;
    flags[name] = value;
  }
  return flags;
}
/** Every recorded flag must match, and no flag may appear or disappear, between prepare and run. */
export function assertFreeUseFlags(recorded: unknown, env: Record<string, string | undefined> = process.env) {
  if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded)) throw Error('FREE_USE_FLAG_DRIFT');
  const canonical = Object.fromEntries(Object.entries(recorded).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  if (JSON.stringify(canonical) !== JSON.stringify(freeUseFlags(env))) throw Error('FREE_USE_FLAG_DRIFT');
}
export type FreeUseCliOptions = { mode: '--prepare' | '--run'; out: string; cases?: string; maxRequests?: number; repeat?: number; mission?: string };
/** No free-form journal path exists: `--mission` accepts only allowlisted ids; `--repeat` is fixed at prepare. */
export function parseFreeUseArgs(argv: string[]): FreeUseCliOptions {
  const args = [...argv], mode = args.shift();
  if (mode !== '--prepare' && mode !== '--run') throw Error('FREE_USE_COMMAND');
  const values: Record<string, string> = {};
  while (args.length) {
    const key = args.shift();
    if (!key || !['--cases', '--out', '--max-requests', '--repeat', '--mission'].includes(key) || !args.length || key in values) throw Error('FREE_USE_ARGUMENT');
    values[key] = args.shift()!;
  }
  if (mode === '--run' && '--repeat' in values) throw Error('FREE_USE_ARGUMENT');
  if (!values['--out']) throw Error('FREE_USE_OUT_REQUIRED');
  return { mode, out: values['--out'], cases: values['--cases'], maxRequests: '--max-requests' in values ? Number(values['--max-requests']) : undefined,
    repeat: '--repeat' in values ? freeUseRepeat(values['--repeat']) : undefined, mission: '--mission' in values ? freeUseMission(values['--mission']).id : undefined };
}
