import { type Model, type ModelRequest, type ModelResponse } from "@everflair/salon-secretary";
import { createRecordedServicesModel, appendRecordedServicesFrames, type RecordedFailure } from '../../packages/salon-secretary/src/recorded-services-model';

/** Explicit recorded-input compatibility, NOT a live SDK wire test.
 * The private static-frame factory owns identity. No provider/network fallback. */
export class ScriptedServicesModel implements Model {
  declare readonly requests:ModelRequest[];
  declare getResponse:Model['getResponse'];
  declare getStreamedResponse:Model['getStreamedResponse'];
  constructor(outputs:ModelResponse['output'][],usage?:Record<string,unknown>,failure?:RecordedFailure){return createRecordedServicesModel(outputs,usage,failure);}
}
/** Explicit static test-data append; never exposes the response closure. */
export const appendScriptedResponses=appendRecordedServicesFrames;
export function call(name: string, args: unknown = {}): ModelResponse["output"] {
  return [{ type: "function_call", callId: crypto.randomUUID(), name, arguments: JSON.stringify(args) }];
}
export function final(text = "Resposta do modelo"): ModelResponse["output"] {
  return [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }];
}
export function serviceScript() {
  return new ScriptedServicesModel([
    call("upsert_action_draft", { name: "Massagem", priceCents: 5000, durationMin: null }),
    call("upsert_action_draft", { name: null, priceCents: null, durationMin: 60 }),
  ], { input_tokens: 400, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 },
    output_tokens: 80, output_tokens_details: { reasoning_tokens: 30 }, total_tokens: 480 });
}
