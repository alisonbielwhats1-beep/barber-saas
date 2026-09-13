import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("../auth", () => ({ authOptions: {} }));
vi.mock("../rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
import { getServerSession } from "next-auth";
import { billingFailure, ownerContext, readBillingBody } from "./http";
import { BillingError } from "./catalog";
import { GET as returnFromProvider } from "@/app/api/billing/return/route";

describe("billing HTTP boundaries", () => {
  beforeEach(() => {
    for (const [k,v] of Object.entries({MERCADOPAGO_BILLING_ENABLED:"true",MERCADOPAGO_MODE:"test",MERCADOPAGO_COLLECTOR_ID:"123",MERCADOPAGO_ACCESS_TOKEN:"test",MERCADOPAGO_WEBHOOK_SECRET:"test",APP_ENV:"test",NEXTAUTH_URL:"http://localhost:3000"})) vi.stubEnv(k,v);
    vi.mocked(getServerSession).mockResolvedValue({user:{id:"owner"}});
  });
  afterEach(()=>vi.unstubAllEnvs());
  it("requires signed-in user, tenant selection and a matching Origin for writes", async () => {
    const url="http://localhost:3000/api/billing/subscriptions?salonId=salon-a";
    await expect(ownerContext(new Request(url,{headers:{origin:"https://evil.test"}}),true)).rejects.toThrow("INVALID_ORIGIN");
    await expect(ownerContext(new Request(url,{headers:{origin:"http://localhost:3000"}}),true)).resolves.toEqual({userId:"owner",salonId:"salon-a"});
    vi.mocked(getServerSession).mockResolvedValue(null);
    await expect(ownerContext(new Request(url))).rejects.toThrow("UNAUTHORIZED");
  });
  it("caps streamed bodies even without Content-Length and rejects invalid JSON", async()=>{
    await expect(readBillingBody(new Request("http://localhost",{method:"POST",body:"x".repeat(4097)}))).rejects.toThrow("BODY_TOO_LARGE");
    await expect(readBillingBody(new Request("http://localhost",{method:"POST",body:"{"}))).rejects.toThrow("INVALID_JSON");
  });
  it("returns safe errors and never caches private responses",async()=>{
    const response=billingFailure(new Error("secret-provider-body"));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("secret-provider-body");
    expect(billingFailure(new BillingError("OWNER_REQUIRED",403)).status).toBe(403);
  });
  it("provider return only explains confirmation; it does not grant a plan",async()=>{
    const response=await returnFromProvider();
    expect(await response.json()).toEqual({message:expect.stringContaining("confirmação do pagamento")});
  });
});
