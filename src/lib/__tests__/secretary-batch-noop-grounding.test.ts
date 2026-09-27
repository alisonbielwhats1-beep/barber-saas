import { describe, expect, it } from 'vitest';
import { groundBatchPatch } from '../secretary-batch';
import { validateBatchPlan } from '../scheduling-batch';

const plan = () => validateBatchPlan({ execution_policy: 'all_or_nothing', items: [
  { key: 'keep_cancel', operation: 'appointment.cancel', depends_on: [], fields: {
    customer_name: 'Cliente Antigo', customer_ref: 'old-client', appointment_ref: 'old-appointment',
    date: '2028-06-13', time: '11:00', reason: 'porque terá reunião',
  } },
  { key: 'change_create', operation: 'appointment.create', depends_on: ['keep_cancel'], released_slot_of: 'keep_cancel', fields: {
    customer_name: 'Cliente Novo', customer_ref: 'new-client', service_name: 'Serviço', service_ref: 'real-service',
  } },
] });
describe('empty domain delta cannot reinterpret accepted sibling state', () => {
  it.each([
    'A Rosa prefere 11h30 em vez de 11h. Mantém o cancelamento do Ivo.',
    'O novo cliente quer às 14h em vez de 11h.',
    'Passe a nova cliente para amanhã às 15h; preserve o cancelamento.',
    'Altere o preço do serviço para cento e dez.',
    'Não mude o cancelamento, só ajuste o novo horário.',
  ])('preserves accepted facts for a no-op regardless of sibling language: %s', message => {
    const original = plan(), before = structuredClone(original);
    const result = groundBatchPatch(original, 'keep_cancel', {}, message, 'America/Sao_Paulo');
    expect(result).toEqual(before); expect(original).toEqual(before); expect(result).not.toBe(original);
    result.items[0].fields.time = '20:00'; expect(original.items[0].fields.time).toBe('11:00');
  });
  it('still validates an unknown item before accepting a no-op', () => {
    expect(() => groundBatchPatch(plan(), 'foreign_action', {}, 'Tudo igual.', 'America/Sao_Paulo')).toThrow('DEPENDENCY_ERROR');
  });
  it('does not treat new temporal evidence as a no-op', () => {
    const original = plan();
    const result = groundBatchPatch(original, 'keep_cancel', {}, 'Agora às 14h.', 'America/Sao_Paulo', [{ field: 'time', text: 'às 14h' }]);
    expect(result.items[0].fields.time).not.toBe('11:00');
    expect(result.items[0].temporal_missing).toContain('time');
  });
  it('does not bypass validation of a non-neutral semantic proof', () => {
    expect(() => groundBatchPatch(plan(), 'keep_cancel', {}, 'Sem alteração.', 'America/Sao_Paulo', undefined, undefined, { forged: true })).toThrow();
  });
});
