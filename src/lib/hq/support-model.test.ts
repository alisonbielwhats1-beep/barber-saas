import {afterEach,describe,it,expect,vi} from "vitest";
import {completeSupport} from "@everflare/agents/support";
afterEach(()=>vi.unstubAllGlobals());
describe("Suporte SDK — saída estruturada e limites",()=>{
 it("usa somente Responses com esquema e sem ferramentas externas",async()=>{
  const output={reply:"Confira a jornada do profissional.",title:"Jornada",category:"Dúvida",recommendation:"reply",needsHuman:false,reason:"Fonte técnica",articleIds:["horarios"]};
  const fetch=vi.fn(async()=>new Response(JSON.stringify({id:"resp_synthetic",object:"response",created_at:1,model:"gpt-5.6-luna",status:"completed",output:[{id:"msg_test",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify(output),annotations:[]}]}],usage:{input_tokens:200,output_tokens:100,total_tokens:300,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}),{headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetch);
  expect(await completeSupport({question:"Jornada?",snapshot:"{}",apiKey:"synthetic"})).toEqual({output,inputTokens:200,outputTokens:100});
  expect(fetch).toHaveBeenCalledTimes(1);const call=fetch.mock.calls[0] as unknown as [RequestInfo,RequestInit];const body=JSON.parse(String(call[1].body));
  expect(String(call[0])).toBe("https://api.openai.com/v1/responses");expect(body.store).toBe(false);expect(body.tools??[]).toEqual([]);expect(body.text.format.type).toBe("json_schema");expect(body.service_tier).toBe("default");expect(body.max_output_tokens).toBe(1200);
 });
 it("não repete falha de rede nem envia entrada acima do limite",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{message:"synthetic"}}),{status:500,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetch);
  await expect(completeSupport({question:"Dúvida",snapshot:"{}",apiKey:"synthetic"})).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
  await expect(completeSupport({question:"Dúvida",snapshot:JSON.stringify({text:"á".repeat(40000)}),apiKey:"synthetic"})).rejects.toThrow("Input limit");expect(fetch).toHaveBeenCalledTimes(1);
 });
});
