import { describe, expect, it } from 'vitest';
import executionSource from '../../test/fixtures/secretary-execution-source.json';
import { groundInventoryQuantity } from '../inventory-quantity';
import { groundSchedulingTemporal } from '../scheduling-temporal-source';

describe('synthetic execution source fidelity, never an oracle rewrite', () => {
  it('preserves the historical placeholder and proves it cannot authorize the scripted stock quantity', () => {
    expect(groundInventoryQuantity({ source: executionSource.originalPlaceholder, quantity: 2, product_names: ['Shampoo X'] }))
      .toMatchObject({ status: 'NEEDS_INPUT' });
  });
  it.each(['stock', 'grouped'] as const)('the explicit %s fixture proves the same original quantity and product', key => {
    expect(groundInventoryQuantity({ source: executionSource[key], quantity: 2, product_names: ['Shampoo X'] }))
      .toMatchObject({ status: 'ACCEPTED', quantity: 2 });
  });
  const move = { customer_name: 'Amanda Souza', source_day_offset: 1, source_time: '10:00', time: '11:00' };
  const groundMove = (source: string) => groundSchedulingTemporal({}, move, source, 'America/Sao_Paulo', new Date('2026-09-26T12:00:00Z'), undefined, 'appointment.change');
  it('does not invent a destination date omitted by the scripted model when the source explicitly requests one', () => {
    expect(groundMove(executionSource.moveWithUnprovidedDestination).rejected)
      .toContainEqual({ code: 'SOURCE_TEMPORAL_CONFLICT', field: 'date', value: 'MISSING' });
  });
  it('faithfully represents the original time-only move without introducing an unprovided destination-date field', () => {
    const result = groundMove(executionSource.move);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({ customer_name: 'Amanda Souza', source_date: '2026-09-27', source_time: '10:00', time: '11:00' });
  });
});
