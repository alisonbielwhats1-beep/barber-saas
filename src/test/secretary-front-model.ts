/** Explicit local E2E interpretation seam. Authentication, domain and execution remain real. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModelResponse, Model } from '@everflair/salon-secretary';
import { createRecordedCursorServicesModel } from '../../packages/salon-secretary/src/recorded-services-model';
export function frontTestModel(): Model {
  const file = resolve(process.env.SECRETARY_FRONT_E2E_SCRIPT!);
  const root = resolve('packages/salon-secretary/evaluation/results/front-voice');
  if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) throw Error('SCRIPT_OUTSIDE_EVIDENCE');
  // Next dev loads route bundles independently. A durable cursor prevents a new
  // route from starting the fake interpretation script again at its first turn.
  const outputs=JSON.parse(readFileSync(file,'utf8')) as ModelResponse['output'][];
  return createRecordedCursorServicesModel(outputs,{evidenceFile:file});
}
