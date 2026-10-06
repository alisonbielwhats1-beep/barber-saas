import { expect, it } from 'vitest';
import { assertEffects, hashes, type Snapshot } from '../../test/secretary-execution-evidence';
import { groundOriginalSchedulingException } from '../scheduling-reason-source';
const before: Snapshot = { Product: [{ id: 'p', salonId: 'fixture', stock: 10, priceCents: 1000 }, { id: 'foreign', salonId: 'other', stock: 7 }], AuditLog: [] };
it('observer accepts only the exact authorized row and columns plus tenant-scoped audit', () => {
  const after = structuredClone(before); after.Product[0].stock = 8;
  after.AuditLog.push({ id: 'audit', salonId: 'fixture', action: 'STOCK_ADJUSTED' });
  expect(assertEffects(before, after, 'fixture', { updates: { Product: { p: ['stock'] } } })).toHaveLength(2);
  expect(hashes(before).Product.sha256).not.toBe(hashes(after).Product.sha256);
});
it.each(['unconfirmed', 'cross-tenant', 'wrong-field', 'deletion', 'unexpected-insert', 'foreign-audit'])('observer stops on %s', kind => {
  const after = structuredClone(before);
  if (kind === 'unconfirmed') after.Product[0].stock = 8;
  if (kind === 'cross-tenant') after.Product[1].stock = 0;
  if (kind === 'wrong-field') after.Product[0].priceCents = 0;
  if (kind === 'deletion') after.Product.shift();
  if (kind === 'unexpected-insert') after.Product.push({ id: 'new', salonId: 'fixture', stock: 9 });
  if (kind === 'foreign-audit') after.AuditLog.push({ id: 'audit', salonId: 'other' });
  expect(() => assertEffects(before, after, 'fixture', kind === 'unconfirmed' ? {} : { updates: { Product: { p: ['stock'], foreign: ['stock'] } } })).toThrow(/UNEXPECTED/);
});
it('observer requires exact counts and detects unchanged records', () => {
  expect(assertEffects(before, structuredClone(before), 'fixture')).toEqual([]);
  expect(() => assertEffects(before, before, 'fixture', { inserts: { Product: 1 } })).toThrow('UNEXPECTED_INSERT_COUNT');
});
it('a composite-key service snapshot rewritten identically has no net insert; any actual service change is rejected', () => {
  const initial: Snapshot = { AppointmentService: [{ appointmentId: 'appointment', position: 0, salonId: 'fixture', serviceId: 'massage', durationMin: 30, priceCents: 10000 }] };
  const rewritten = structuredClone(initial);
  expect(assertEffects(initial, rewritten, 'fixture')).toEqual([]);
  expect(() => assertEffects(initial, rewritten, 'fixture', { inserts: { AppointmentService: 1 } })).toThrow('UNEXPECTED_INSERT_COUNT');
  rewritten.AppointmentService[0].durationMin = 45;
  expect(() => assertEffects(initial, rewritten, 'fixture')).toThrow('UNEXPECTED_MUTATION');
});
it('the operational overlap fixture must provide the consent required by the published grounding contract', () => {
  const fields = { override_requested: true, override_reason: 'Cliente já está aguardando' };
  expect(() => groundOriginalSchedulingException({ ...fields }, {}, 'Cancele Amanda a pedido da cliente e encaixe Fábio com Corte Completo no lugar. Motivo: Cliente já está aguardando.'))
    .toThrow('OVERRIDE_INTENT_NOT_GROUNDED');
  expect(() => groundOriginalSchedulingException({ ...fields }, {}, 'Cancele Amanda a pedido da cliente e coloque Fábio com Corte Completo no lugar. Pode encaixar. Motivo: Cliente já está aguardando.')).not.toThrow();
});
