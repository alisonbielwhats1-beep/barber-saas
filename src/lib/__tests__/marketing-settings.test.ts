import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAPSED_CLIENT_DAYS,
  MAX_LAPSED_CLIENT_DAYS,
  MIN_LAPSED_CLIENT_DAYS,
  normalizeLapsedClientDays,
  parseMarketingSettings,
} from "@/lib/marketing-settings";

describe("marketing settings", () => {
  it("uses safe defaults for missing or invalid metadata", () => {
    expect(parseMarketingSettings(null)).toEqual({
      lapsedClientDays: DEFAULT_LAPSED_CLIENT_DAYS,
      googleReviewUrl: null,
    });
    expect(normalizeLapsedClientDays(12.5)).toBe(DEFAULT_LAPSED_CLIENT_DAYS);
  });

  it("clamps the lapsed-client window", () => {
    expect(normalizeLapsedClientDays(1)).toBe(MIN_LAPSED_CLIENT_DAYS);
    expect(normalizeLapsedClientDays(999)).toBe(MAX_LAPSED_CLIENT_DAYS);
    expect(normalizeLapsedClientDays(45)).toBe(45);
  });

  it("accepts only https review links", () => {
    expect(parseMarketingSettings({
      lapsedClientDays: 90,
      googleReviewUrl: "https://g.page/r/example/review",
    })).toEqual({
      lapsedClientDays: 90,
      googleReviewUrl: "https://g.page/r/example/review",
    });
    expect(parseMarketingSettings({ googleReviewUrl: "http://example.com" }).googleReviewUrl).toBeNull();
  });
});
