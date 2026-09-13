import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("server-only",()=>({}));
import { billingConfig } from "./config";
import { verifyWebhook, checkoutUrl, mpRequest } from "./provider";
describe("Mercado Pago trust boundaries",()=>{
  beforeEach(()=>{vi.stubEnv("MERCADOPAGO_BILLING_ENABLED","true");vi.stubEnv("MERCADOPAGO_MODE","test");vi.stubEnv("MERCADOPAGO_COLLECTOR_ID","123");vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN","test-only");vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET","test-secret");vi.stubEnv("APP_ENV","test");vi.stubEnv("NEXTAUTH_URL","http://localhost:3000");});
  afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
  it("rejects missing configuration and test/live crossover",()=>{
    expect(billingConfig().mode).toBe("test");vi.stubEnv("APP_ENV","production");expect(()=>billingConfig()).toThrow("BILLING_ENVIRONMENT_MISMATCH");
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED","false");expect(()=>billingConfig()).toThrow("BILLING_DISABLED");
  });
  it("authenticates the documented manifest and rejects resource substitution",()=>{
    const digest=createHmac("sha256","secret").update("id:abc;request-id:req;ts:1704908010;").digest("hex");
    const headers=new Headers({"x-request-id":"req","x-signature":`ts=1704908010,v1=${digest}`});
    expect(()=>verifyWebhook(headers,"ABC","secret")).not.toThrow();
    expect(()=>verifyWebhook(headers,"other","secret")).toThrow("INVALID_SIGNATURE");
    expect(()=>verifyWebhook(headers,"ABC","wrong")).toThrow("INVALID_SIGNATURE");
    expect(()=>verifyWebhook(new Headers(),"ABC","secret")).toThrow("INVALID_SIGNATURE");
  });
  it("rejects checkout redirects outside the provider",()=>{
    expect(checkoutUrl("https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=abc")).toContain("preapproval_id");
    for(const url of ["https://www.mercadopago.com.br.evil.test/","http://www.mercadopago.com.br/","https://user:pass@www.mercadopago.com.br/"]) expect(()=>checkoutUrl(url)).toThrow();
  });
  it("never repeats a failed POST or leaks the provider response",async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{"access_token":"sensitive"}',{status:500}));vi.stubGlobal("fetch",fetch);
    await expect(mpRequest("/preapproval","POST",{})).rejects.toThrow("PROVIDER_UNAVAILABLE");expect(fetch).toHaveBeenCalledTimes(1);
  });
});
