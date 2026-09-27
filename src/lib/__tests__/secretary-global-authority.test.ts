import { describe, expect, it } from 'vitest';
import { createServicesAgent, withConversationRouting } from '@everflair/salon-secretary';
import { ScriptedServicesModel } from '../../test/scripted-services-model';

describe('the conversation has one capability authority independent of its current adapter', () => {
  it.each(['services', 'customers', 'scheduling', 'scheduling-batch', 'inventory', 'financial', 'communication'] as const)(
    'publishes the same global semantic instructions when continuing %s', async skill => {
      await withConversationRouting(async () => {
        const model = new ScriptedServicesModel([]);
        const discovery = createServicesAgent(model, () => {}, 'discovery', true);
        const continuation = createServicesAgent(model, () => {}, skill, true);
        // The backend context chooses a pending field; an adapter cannot shrink
        // the assistant's advertised capabilities or veto an unrelated new task.
        expect(continuation.instructions).toBe(discovery.instructions);
        expect(continuation.instructions).toContain('financial.report');
        expect(continuation.instructions).toContain('stock.movement');
        expect(continuation.instructions).toContain('EXACT');
        expect(continuation.tools).toHaveLength(1);
        expect(model.requests).toHaveLength(0);
      });
    },
  );

  it('retains the isolated legacy service contract without a conversation coordinator', () => {
    const legacy = createServicesAgent(new ScriptedServicesModel([]), () => {}, 'services');
    expect(legacy.instructions).toContain('somente criação e alteração segura de serviço');
  });
});
