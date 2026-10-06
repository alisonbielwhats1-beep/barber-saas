import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { secretaryContractVersion, secretaryContractDigest, secretaryContractParts, withConversationRouting, withSalonDirectory } from '@everflair/salon-secretary';
import { CONTRACT_PROFILES, CONTRACT_VERSION_FILE, contractProfileDigest, contractVersionDrift, liveContractVersionFile, type ContractVersionFile } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { RouterTrace, type TurnOutcome } from '../secretary-router';
import { STRESS_CONTEXT, LINT_DIRECTORY } from '../../test/secretary-instruction-lint';

/** C6 (rec 19): one version for what reaches the model; the checked-in file changes only deliberately. */
afterEach(() => { vi.unstubAllEnvs(); });

describe('checked-in contract version', () => {
  it('packages/salon-secretary/contract-version.json matches the live contract of every profile', () => {
    const recorded = JSON.parse(readFileSync(join(process.cwd(), CONTRACT_VERSION_FILE), 'utf8')) as ContractVersionFile;
    const drift = contractVersionDrift(recorded);
    if (drift.length) throw Error(`SECRETARY MODEL CONTRACT CHANGED without updating ${CONTRACT_VERSION_FILE}: ` +
      drift.map(d => `${d.profile} (${d.parts.join('+') || 'profile added/removed'}) ${d.recorded?.slice(0, 12) ?? 'none'} -> ${d.live?.slice(0, 12) ?? 'none'}`).join('; ') +
      '. The prompt, wire, model, output limit or contract flags changed: re-run Golden pass^k and the practice battery for these profiles, ' +
      'then record the new versions with: npx tsx scripts/secretary-contract-version.ts --write');
    expect(recorded.schema).toBe('secretary-contract-v1'); expect(Object.keys(recorded.profiles).sort()).toEqual(Object.keys(CONTRACT_PROFILES).sort());
  });
  it('the drift names the changed profile and part', () => {
    const live = liveContractVersionFile(), tampered = structuredClone(live);
    tampered.profiles['v2+jit'].version = '0'.repeat(64); tampered.profiles['v2+jit'].parts.wires = '0'.repeat(64);
    expect(contractVersionDrift(live, live)).toEqual([]);
    expect(contractVersionDrift(tampered, live)).toEqual([{ profile: 'v2+jit', recorded: '0'.repeat(64), live: live.profiles['v2+jit'].version, parts: ['wires'] }]);
  });
});

describe('what the version covers', () => {
  const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
  it('every contract input changes it; the profiles are distinct', () => {
    const base = contractProfileDigest(v2);
    expect(base.version).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(Object.values(CONTRACT_PROFILES).map(env => contractProfileDigest(env).version)).size).toBe(Object.keys(CONTRACT_PROFILES).length);
    const changed = (env: Record<string, string>, model?: string) => contractProfileDigest({ ...v2, ...env }, model);
    // Model and output limit are runtime parts; templates and wire stay.
    for (const other of [changed({}, 'gpt-5.6-luna'), changed({ SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS: '4096' }), changed({ SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true' })]) {
      expect(other.version).not.toBe(base.version); expect(other.parts.runtime).not.toBe(base.parts.runtime);
      expect(other.parts.templates).toBe(base.parts.templates); expect(other.parts.wires).toBe(base.parts.wires);
    }
    // Components change the prompt and the wire; JIT the prompt (and a state-narrowed wire description).
    const components = changed({ SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true' }), jit = changed({ SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' });
    expect(components.parts.templates).not.toBe(base.parts.templates); expect(components.parts.wires).not.toBe(base.parts.wires);
    expect(jit.parts.templates).not.toBe(base.parts.templates); expect(jit.parts.wires).not.toBe(base.parts.wires);
    // Examples: mode, K and the bank (hash) enter only while examples reach the model.
    const selected = changed({ SALON_SECRETARY_EXAMPLES: 'selected' }), full = changed({ SALON_SECRETARY_EXAMPLES: 'full' }), k8 = changed({ SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_EXAMPLES_K: '8' });
    expect(new Set([base.version, selected.version, full.version, k8.version]).size).toBe(4);
    expect(changed({ SALON_SECRETARY_EXAMPLES: 'off' }).version).toBe(base.version);
    vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true'); vi.stubEnv('SALON_SECRETARY_EXAMPLES', 'selected');
    const parts = secretaryContractParts({ modelId: 'gpt-6-luna' });
    expect(parts.templates.examples?.bank).toMatch(/^[0-9a-f]{64}$/);
    vi.stubEnv('SALON_SECRETARY_EXAMPLES', 'off');
    expect(secretaryContractParts({ modelId: 'gpt-6-luna' }).templates.examples).toBeNull();
  });
  it('per-turn data never enters it (plan, directory, today, routing state) and it is memoized per environment', async () => {
    vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true'); vi.stubEnv('SALON_SECRETARY_TEMPORAL_COMPONENTS', 'true');
    const outside = secretaryContractDigest({ modelId: 'gpt-6-luna' });
    const inside = await withSalonDirectory(LINT_DIRECTORY, () => withConversationRouting(async () => secretaryContractDigest({ modelId: 'gpt-6-luna' }), STRESS_CONTEXT));
    expect(inside).toEqual(outside);
    expect(secretaryContractVersion({ modelId: 'gpt-6-luna' })).toBe(outside.version);
    const text = JSON.stringify(secretaryContractParts({ modelId: 'gpt-6-luna' }));
    for (const data of ['2026-09-28', 'Profissional Sintética', 'item_0', STRESS_CONTEXT.active_plan!.plan_ref]) expect(text).not.toContain(data);
    vi.stubEnv('SALON_SECRETARY_TEMPORAL_COMPONENTS', 'false');
    expect(secretaryContractVersion({ modelId: 'gpt-6-luna' })).not.toBe(outside.version);
  });
});

describe('backend presentation texts (review): what the backend writes into the model context is a contract part', () => {
  it('a changed label, preview prefix or notice changes the version; the calendar, the year and ICU spacing do not', async () => {
    const { backendPresentationTexts, presentationDigest, backendPresentationDigest } = await import('../secretary-presentation-contract');
    const texts = backendPresentationTexts(), digest = presentationDigest(texts);
    expect(digest).toMatch(/^[0-9a-f]{64}$/); expect(backendPresentationDigest()).toBe(digest);
    const relabeled = structuredClone(texts); relabeled.labels['appointment.create'].date = 'data';
    const reworded = structuredClone(texts); reworded.previews[0] = reworded.previews[0].replace('NOVO AGENDAMENTO', 'AGENDAMENTO NOVO');
    const suffix = structuredClone(texts); suffix.confirm = 'Confirme.';
    for (const changed of [relabeled, reworded, suffix]) expect(presentationDigest(changed)).not.toBe(digest);
    vi.useFakeTimers(); try {
      vi.setSystemTime(new Date('2031-02-10T12:00:00Z')); const later = presentationDigest();
      vi.setSystemTime(new Date('2027-11-03T12:00:00Z')); expect(presentationDigest()).toBe(later);
    } finally { vi.useRealTimers(); }
    expect(presentationDigest(JSON.parse(JSON.stringify(texts).replace(/R\$ /g, 'R$ ')))).toBe(digest);
    // Screen-only text never enters it: the C7 existing-booking notice is not part of any preview.
    expect(JSON.stringify(texts)).not.toMatch(/Atenção|remarcar/);
  });
  it('given, the digest is a part of the version and of the drift; the recorded profiles carry it', () => {
    const base = { modelId: 'gpt-6-luna' };
    const a = secretaryContractDigest({ ...base, presentation: 'a'.repeat(64) }), b = secretaryContractDigest({ ...base, presentation: 'b'.repeat(64) });
    expect(a.version).not.toBe(b.version); expect(a.parts.templates).toBe(b.parts.templates); expect(a.parts.wires).toBe(b.parts.wires);
    expect(a.parts).toMatchObject({ presentation: 'a'.repeat(64) });
    expect(secretaryContractVersion({ ...base, presentation: 'a'.repeat(64) })).toBe(a.version);
    expect(secretaryContractVersion({ ...base, presentation: 'b'.repeat(64) })).toBe(b.version);
    expect(Object.values(liveContractVersionFile().profiles).every(entry => /^[0-9a-f]{64}$/.test((entry.parts as { presentation?: string }).presentation ?? ''))).toBe(true);
  });
});

describe('turn outcome telemetry', () => {
  it('the router row keeps a sha256 contract version and drops anything else', () => {
    const outcome = { kind: 'CONVERSATION', groups_ready: 0, groups_total: 0, open_question_fields: [], question_fingerprints: [], repeated_question_count: 0,
      divergence: { luna_operations: 0, plan_actions: 0, dropped_fields: [], failed_codes: [] }, repairs: 0, error_code: null } as TurnOutcome;
    const trace = new RouterTrace(), version = 'ab'.repeat(32);
    trace.outcome = { ...outcome, contract_version: version };
    expect(trace.snapshot().outcome).toMatchObject({ contract_version: version });
    for (const bad of ['v1', 'AB'.repeat(32), 'Pessoa Sintética', 'ab'.repeat(33)]) {
      trace.outcome = { ...outcome, contract_version: bad };
      expect(trace.snapshot().outcome).not.toHaveProperty('contract_version');
    }
  });
});
