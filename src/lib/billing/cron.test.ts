import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ worker: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/billing/worker", () => ({ runBillingWorker: mocks.worker }));
vi.mock("@/lib/billing/config", () => ({ billingEnabled: mocks.enabled }));
vi.mock("@/lib/billing/http", () => ({
  billingJson: (body: unknown, status = 200) => Response.json(body, { status }),
  billingFailure: () => Response.json({ error: "FAILED" }, { status: 503 }),
}));
import { GET } from "@/app/api/cron/billing/route";
const request = (secret?: string) => new Request("http://localhost/api/cron/billing", {
  headers: secret ? { authorization: `Bearer ${secret}` } : {},
});
describe("billing reconciler credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "legacy-reminder-key");
    vi.stubEnv("BILLING_CRON_SECRET", "dedicated-billing-key");
    mocks.enabled.mockReturnValue(true);
    mocks.worker.mockResolvedValue({ processed: 1, failed: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("accepts the billing key and processes only one unit", async () => {
    const response = await GET(request("dedicated-billing-key"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1, failed: 0 });
    expect(mocks.worker).toHaveBeenCalledExactlyOnceWith(1);
  });
  it.each([undefined, "wrong-key", "legacy-reminder-key"])("rejects %s when a dedicated key is configured", async secret => {
    expect((await GET(request(secret))).status).toBe(401);
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("preserves legacy installations without a dedicated key", async () => {
    vi.stubEnv("BILLING_CRON_SECRET", "");
    expect((await GET(request("legacy-reminder-key"))).status).toBe(200);
  });
  it("fails closed without either key", async () => {
    vi.stubEnv("BILLING_CRON_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(401);
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("authenticates even while billing is disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await GET(request())).status).toBe(401);
    const response = await GET(request("dedicated-billing-key"));
    expect(await response.json()).toEqual({ disabled: true });
    expect(mocks.worker).not.toHaveBeenCalled();
  });
});
