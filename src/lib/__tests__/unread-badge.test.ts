import { describe, expect, it } from "vitest";
import { unreadCountLabel } from "@/lib/notification-ui";

describe("unreadCountLabel", () => {
  it("mantém contagens pequenas legíveis", () => {
    expect(unreadCountLabel(1)).toBe("1");
    expect(unreadCountLabel(27)).toBe("27");
  });

  it("limita contagens grandes sem alargar a navegação", () => {
    expect(unreadCountLabel(99)).toBe("99");
    expect(unreadCountLabel(100)).toBe("99+");
  });
});
