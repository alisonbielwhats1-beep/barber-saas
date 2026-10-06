import { afterEach, describe, expect, it, vi } from 'vitest';
import { contractProfileDigest } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { entityQuoteDenied, temporalQuoteDenied } from '../scheduling-temporal-source';
import { alteredServiceIds } from '../scheduling-mutations';

/** Phase 2 fixer (adversarial reviews A and B of P2a/P2b/P2c): pure regressions. Adapter-level regressions live beside each
 * feature's own adapter suite (secretary-alter-appointment-adapter, secretary-multi-service-adapter, secretary-origin-from-ref). */
afterEach(() => { vi.unstubAllEnvs(); });

describe('review B (low): SALON_SECRETARY_COPY_V2 is versioned (the wording Luna reads as data)', () => {
  it('flag off (unset or explicit) keeps the recorded version; on names it, so a recorded profile tells the two apart', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
    const off = contractProfileDigest(v2), explicitOff = contractProfileDigest({ ...v2, SALON_SECRETARY_COPY_V2: 'false' }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_COPY_V2: 'true' });
    expect(explicitOff).toEqual(off);
    expect(on.version).not.toBe(off.version); expect(on.parts.runtime).not.toBe(off.parts.runtime);
    expect(on.parts.templates).toBe(off.parts.templates); expect(on.parts.wires).toBe(off.parts.wires);
  });
});

/** The quote of `literal` in `text` (first occurrence), as the grounding locates it. */
const at = (text: string, literal: string) => { const start = text.indexOf(literal); return [start, start + literal.length] as const; };
describe('review A (low): the privative "sem" denies an entity literal it governs (services and professionals only)', () => {
  it.each([
    ['A Luana vai fazer pezinho também, sem barba', 'barba', true],
    ['Marca manicure e pedicure pra Céu, sem a esmaltação', 'esmaltação', true],
    ['Faz a limpeza de pele da Duda sem nenhuma extração', 'extração', true],
    ['Passa o Téo pra outra pessoa, sem a Jade', 'Jade', true],
    ['Marca corte e barba pro Nando', 'barba', false],
    ['Na semana que vem a Luz faz sobrancelha', 'sobrancelha', false],
    ['Marca barba sem pressa pro Kevin', 'barba', false],
  ] as const)('%s → %s denied: %s', (text, literal, denied) => {
    const [start, end] = at(text, literal);
    expect(entityQuoteDenied(text, start, end, 'appointment.change')).toBe(denied);
  });
  it('temporal quotes keep their own class ("sem" is not a negator of a date or clock)', () => {
    const text = 'Remarca a Jade sem falta pra sexta às 10h', [start, end] = at(text, 'às 10h');
    expect(temporalQuoteDenied(text, start, end, 'appointment.change')).toBe(false);
  });
});
describe("review A (low): a SET of the same services in another order is the appointment's own list", () => {
  it('keeps the domain order (a no-op), while a different set is the new list in the said order', () => {
    expect(alteredServiceIds(['s-corte', 's-barba'], [{ mode: 'SET', ref: 's-barba' }, { mode: 'SET', ref: 's-corte' }])).toEqual({ ids: ['s-corte', 's-barba'] });
    expect(alteredServiceIds(['s-corte', 's-barba'], [{ mode: 'SET', ref: 's-barba' }, { mode: 'SET', ref: 's-pezinho' }])).toEqual({ ids: ['s-barba', 's-pezinho'] });
    expect(alteredServiceIds(['s-corte'], [{ mode: 'SET', ref: 's-corte' }, { mode: 'SET', ref: 's-barba' }])).toEqual({ ids: ['s-corte', 's-barba'] });
  });
});
