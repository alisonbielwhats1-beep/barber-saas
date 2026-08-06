import { describe, expect, it } from "vitest";
import { isUnconfiguredVercelPreview } from "../runtime-environment";

describe("isUnconfiguredVercelPreview", () => {
  it.each([undefined, "", "development", "test", "production"])(
    "bloqueia Preview sem APP_ENV=staging: %s",
    (appEnvironment) => {
      expect(
        isUnconfiguredVercelPreview({
          APP_ENV: appEnvironment,
          VERCEL_ENV: "preview",
        }),
      ).toBe(true);
    },
  );

  it("libera Preview configurado deliberadamente como staging", () => {
    expect(
      isUnconfiguredVercelPreview({
        APP_ENV: "staging",
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
  });

  it.each([undefined, "development", "production"])(
    "não interfere fora de Vercel Preview: %s",
    (vercelEnvironment) => {
      expect(
        isUnconfiguredVercelPreview({
          APP_ENV: "production",
          VERCEL_ENV: vercelEnvironment,
        }),
      ).toBe(false);
    },
  );
});
