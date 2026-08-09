import { describe, expect, it } from "vitest";
import { SEGMENTS } from "@/lib/segments";
import { getBusinessExperience } from "../index";

describe("business experience registry", () => {
  it("defines a complete experience for every supported segment", () => {
    for (const segment of SEGMENTS) {
      const experience = getBusinessExperience(segment.id);

      expect(experience.id).toBe(segment.id);
      expect(experience.visual.direction).toBeTruthy();
      expect(experience.visual.catalogLayout).toBeTruthy();
      expect(experience.visual.publicLayout).toBeTruthy();
      expect(experience.dashboard.metricOrder).toHaveLength(4);
      expect(experience.imagery.heroImages.length).toBeGreaterThan(0);
    }
  });

  it("keeps the five experiences structurally distinct", () => {
    const configured = SEGMENTS.map((segment) => getBusinessExperience(segment.id));

    expect(new Set(configured.map((item) => item.visual.direction)).size).toBe(5);
    expect(new Set(configured.map((item) => item.visual.catalogLayout)).size).toBe(5);
    expect(new Set(configured.map((item) => item.visual.publicLayout)).size).toBe(5);
  });

  it("falls back safely when an old or invalid segment is read", () => {
    expect(getBusinessExperience("legacy-value").id).toBe("generic");
    expect(getBusinessExperience(null).id).toBe("generic");
  });
});
