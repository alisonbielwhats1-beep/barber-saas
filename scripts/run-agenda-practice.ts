/** CLI: node scripts/run-agenda-practice.cjs --scenarios <file.json> [--only A01,A02] [--max-requests N]
 * Requires AGENDA_PRACTICE_REAL_APPROVED=true (paid Luna calls under the USD 7 stage journal). */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAgendaPractice, type AgendaScenario } from '../packages/salon-secretary/evaluation/agenda-practice';
async function main() {
  const args = process.argv.slice(2), values: Record<string, string> = {};
  while (args.length) { const key = args.shift()!; if (!['--scenarios', '--only', '--max-requests', '--label'].includes(key) || !args.length) throw Error('AGENDA_ARGUMENT'); values[key] = args.shift()!; }
  if (process.env.AGENDA_PRACTICE_REAL_APPROVED !== 'true') throw Error('AGENDA_PRACTICE_NOT_APPROVED');
  const all = JSON.parse(readFileSync(resolve(values['--scenarios'] ?? 'packages/salon-secretary/evaluation/agenda-practice-scenarios.json'), 'utf8')) as AgendaScenario[];
  const only = values['--only']?.split(',');
  const scenarios = only ? all.filter(s => only.includes(s.id)) : all;
  const label = (values['--label'] ?? 'run').replace(/[^a-z0-9-]/gi, '');
  const out = join(process.cwd(), 'packages/salon-secretary/evaluation/results/agenda-core', `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`);
  const report = await runAgendaPractice(scenarios, out, { maxRequests: Number(values['--max-requests'] ?? 120) });
  console.log(JSON.stringify({ out, ...report }));
}
main().catch(error => { process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false'; console.error(JSON.stringify({ status: 'BLOCKED', code: error instanceof Error ? error.message.slice(0, 200) : 'ERROR' })); process.exitCode = 1; });
