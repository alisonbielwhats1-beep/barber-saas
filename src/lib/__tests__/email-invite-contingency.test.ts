import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptExistingUserInvite: vi.fn(),
  acceptNewUserInvite: vi.fn(),
}));

vi.mock("@/lib/invitations", () => ({
  acceptExistingUserInvite: mocks.acceptExistingUserInvite,
  acceptNewUserInvite: mocks.acceptNewUserInvite,
}));

import { acceptInvite } from "@/app/convite/[token]/actions";
import { EMAIL_INVITES_DISABLED_MESSAGE } from "@/lib/email-invites-feature";

describe("contingência dos endpoints de convite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_INVITES_ENABLED", "false");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
  });

  it("interrompe a página antes de consultar sessão ou convite", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/convite/[token]/page.tsx"),
      "utf8",
    );
    const gate = source.indexOf("if (!emailInvitesEnabled())");
    const sessionLookup = source.indexOf("await getServerSession(", gate);
    const inviteLookup = source.indexOf("await getInviteView(", gate);

    expect(gate).toBeGreaterThan(-1);
    expect(sessionLookup).toBeGreaterThan(gate);
    expect(inviteLookup).toBeGreaterThan(gate);
  });

  it("bloqueia chamada direta da Server Action antes do aceite", async () => {
    const result = await acceptInvite({
      token: "token-com-tamanho-suficiente",
      mode: "new",
      password: "senha-segura",
      confirmPassword: "senha-segura",
    });

    expect(result).toEqual({
      ok: false,
      error: EMAIL_INVITES_DISABLED_MESSAGE,
    });
    expect(mocks.acceptNewUserInvite).not.toHaveBeenCalled();
    expect(mocks.acceptExistingUserInvite).not.toHaveBeenCalled();
  });
});
