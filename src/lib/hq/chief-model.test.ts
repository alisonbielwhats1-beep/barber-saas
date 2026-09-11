import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChief, estimateChiefMicros, CHIEF_RESERVATION_MICROS } from "@everflare/agents/chief";
afterEach(()=>vi.unstubAllGlobals());
describe("Chefe — contrato real do SDK com transporte fictício",()=>{
 it("usa uma chamada Responses sem ferramentas, armazenamento ou tentativas automáticas",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({
   id:"resp_synthetic",object:"response",created_at:1,model:"gpt-5.6-luna",status:"completed",
   output:[{id:"msg_synthetic",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"Há 2 tickets no HQ. [Suporte]",annotations:[]}]}],
   usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}},
  }),{headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetch);
  const result=await completeChief({question:"Há tickets?",snapshot:JSON.stringify({tickets:2}),apiKey:"fake-test-key"});
  expect(result).toEqual({output:"Há 2 tickets no HQ. [Suporte]",inputTokens:100,outputTokens:20});
  expect(fetch).toHaveBeenCalledTimes(1);
  const call=fetch.mock.calls[0] as unknown as [RequestInfo,RequestInit];
  const requestBody=JSON.parse(String(call[1].body));
  expect(requestBody.model).toBe("gpt-5.6-luna");expect(requestBody.store).toBe(false);
  expect(requestBody.max_output_tokens).toBe(1200);
  expect(requestBody.service_tier).toBe("default");
  expect(requestBody.tools??[]).toEqual([]);
  expect(String(call[0])).toBe("https://api.openai.com/v1/responses");
 });
 it("não repete erro do provedor e recusa entrada excessiva antes da rede",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{message:"synthetic",type:"server_error"}}),{status:500,headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetch);
  await expect(completeChief({question:"Resumo",snapshot:"{}",apiKey:"fake"})).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(completeChief({question:"Resumo",snapshot:JSON.stringify({data:"á".repeat(40000)}),apiKey:"fake"})).rejects.toThrow("Input limit");
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("reserva margem superior ao teto teórico do piloto",()=>{
  expect(estimateChiefMicros(40000,1200)).toBeLessThan(CHIEF_RESERVATION_MICROS);
  expect(estimateChiefMicros(100,20)).toBe(49);
 });
});
