import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { legacyEvidenceFs } from '../../test/secretary-legacy-evidence';
import { verifyFrozen } from '../../../packages/salon-secretary/evaluation/hard-conversations-preflight';
import { assertInventoryAuditPins } from '../../../packages/salon-secretary/evaluation/inventory-readonly-plan';

// Default reads are live. Historical redirection exists only inside its explicit test scope.
vi.mock('node:fs',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs')>();
  return {...actual,readFileSync:vi.fn(actual.readFileSync)};
});
const fixture='src/test/fixtures/secretary-v1-frozen-sources.json';
const inventory='packages/salon-secretary/src/inventory-skill.ts';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');

describe('historical source replay never authorizes the changed live runtime',()=>{
  it('keeps original source bytes and every frozen case unchanged in the archived read scope',async()=>{
    const actual=await vi.importActual<typeof import('node:fs')>('node:fs');
    const manifest=JSON.parse(actual.readFileSync('packages/salon-secretary/evaluation/hard-conversations-plan.json','utf8'));
    const archive=JSON.parse(actual.readFileSync(fixture,'utf8')) as Record<string,string>;
    for(const [file,bytes] of Object.entries(archive))expect(hash(bytes),file).toBe(manifest.predecessors[file]);
    await vi.mocked(readFileSync).withImplementation(legacyEvidenceFs(actual),async()=>{
      expect(verifyFrozen(process.cwd()).cases).toEqual(manifest.cases);
      expect(()=>assertInventoryAuditPins()).not.toThrow();
      expect(hash(readFileSync(inventory))).toBe(manifest.predecessors[inventory]);
    });
    expect(hash(readFileSync(inventory))).not.toBe(manifest.predecessors[inventory]);
  });
  it('keeps live admission fail-closed against old seals without any historical reader',()=>{
    expect(()=>verifyFrozen(process.cwd())).toThrow(/HASH_MISMATCH:/);
    expect(()=>assertInventoryAuditPins()).toThrow(/DRIFT/);
  });
  it('rejects even a one-byte archive change instead of replacing the immutable expected hash',async()=>{
    const actual=await vi.importActual<typeof import('node:fs')>('node:fs');
    const archive=JSON.parse(actual.readFileSync(fixture,'utf8')) as Record<string,string>;
    archive[inventory]+=' ';
    const alteredRead=((file:Parameters<typeof actual.readFileSync>[0],options?:Parameters<typeof actual.readFileSync>[1])=>
      String(file).replaceAll('\\','/').endsWith(fixture)?JSON.stringify(archive):actual.readFileSync(file,options)) as typeof actual.readFileSync;
    expect(()=>legacyEvidenceFs({...actual,readFileSync:alteredRead})).toThrow('INVALID_LEGACY_SOURCE_ARCHIVE:'+inventory);
  });
});
