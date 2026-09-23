import { beforeEach, describe, expect, it } from "vitest";
import { AuthError, AuthService } from "./service.js";
import { MemoryAuthStore } from "./memoryStore.js";

describe("AuthService", () => {
  let store: MemoryAuthStore;
  let clock: number;
  let sent: { email: string; code: string }[];
  let auth: AuthService;

  beforeEach(() => {
    store = new MemoryAuthStore();
    clock = 1_700_000_000_000;
    sent = [];
    auth = new AuthService(store, {
      pepper: "test-pepper",
      now: () => clock,
      sendCode: (email, code) => {
        sent.push({ email, code });
      },
    });
  });

  function lastCode(): string {
    return sent[sent.length - 1]!.code;
  }

  it("sends a six digit code", async () => {
    await auth.requestCode("kavya@example.com");

    expect(sent).toHaveLength(1);
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it("rejects something that is not an email", async () => {
    await expect(auth.requestCode("not-an-email")).rejects.toMatchObject({
      code: "invalid_email",
    });
  });

  it("treats addresses case insensitively", async () => {
    await auth.requestCode("Kavya@Example.com");
    const { user } = await auth.verifyCode("kavya@example.com", lastCode());

    expect(user.email).toBe("kavya@example.com");
  });

  it("refuses a second code within the cooldown", async () => {
    await auth.requestCode("kavya@example.com");

    await expect(auth.requestCode("kavya@example.com")).rejects.toMatchObject({
      code: "cooldown",
    });
  });

  it("allows another code after the cooldown", async () => {
    await auth.requestCode("kavya@example.com");
    clock += 61_000;
    await auth.requestCode("kavya@example.com");

    expect(sent).toHaveLength(2);
  });

  it("creates the account on first successful sign in", async () => {
    await auth.requestCode("kavya@example.com");
    const { user, token } = await auth.verifyCode("kavya@example.com", lastCode());

    expect(user.role).toBe("attendee");
    expect(token.length).toBeGreaterThan(20);
    expect(await store.findUserByEmail("kavya@example.com")).not.toBeNull();
  });

  it("reuses the same account on later sign ins", async () => {
    await auth.requestCode("kavya@example.com");
    const first = await auth.verifyCode("kavya@example.com", lastCode());

    clock += 61_000;
    await auth.requestCode("kavya@example.com");
    const second = await auth.verifyCode("kavya@example.com", lastCode());

    expect(second.user.id).toBe(first.user.id);
    expect(second.token).not.toBe(first.token);
  });

  it("rejects a wrong code", async () => {
    await auth.requestCode("kavya@example.com");
    const wrong = lastCode() === "000000" ? "111111" : "000000";

    await expect(
      auth.verifyCode("kavya@example.com", wrong)
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("locks the code after five wrong attempts", async () => {
    await auth.requestCode("kavya@example.com");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        auth.verifyCode("kavya@example.com", wrong)
      ).rejects.toMatchObject({ code: "invalid_code" });
    }

    await expect(
      auth.verifyCode("kavya@example.com", wrong)
    ).rejects.toMatchObject({ code: "too_many_attempts" });

    await expect(
      auth.verifyCode("kavya@example.com", code)
    ).rejects.toMatchObject({ code: "no_code" });
  });

  it("rejects an expired code", async () => {
    await auth.requestCode("kavya@example.com");
    const code = lastCode();
    clock += 11 * 60 * 1000;

    await expect(
      auth.verifyCode("kavya@example.com", code)
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("only lets a code be used once", async () => {
    await auth.requestCode("kavya@example.com");
    const code = lastCode();
    await auth.verifyCode("kavya@example.com", code);

    await expect(
      auth.verifyCode("kavya@example.com", code)
    ).rejects.toMatchObject({ code: "no_code" });
  });

  it("rejects verifying with no code requested", async () => {
    await expect(
      auth.verifyCode("stranger@example.com", "123456")
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("resolves a session token to its user", async () => {
    await auth.requestCode("kavya@example.com");
    const { token, user } = await auth.verifyCode("kavya@example.com", lastCode());

    expect((await auth.resolveToken(token))?.id).toBe(user.id);
  });

  it("resolves nothing for a missing or unknown token", async () => {
    expect(await auth.resolveToken(undefined)).toBeNull();
    expect(await auth.resolveToken("made-up-token")).toBeNull();
  });

  it("stops resolving an expired session", async () => {
    await auth.requestCode("kavya@example.com");
    const { token } = await auth.verifyCode("kavya@example.com", lastCode());

    clock += 31 * 24 * 60 * 60 * 1000;

    expect(await auth.resolveToken(token)).toBeNull();
  });

  it("invalidates the token on logout", async () => {
    await auth.requestCode("kavya@example.com");
    const { token } = await auth.verifyCode("kavya@example.com", lastCode());

    await auth.logout(token);

    expect(await auth.resolveToken(token)).toBeNull();
  });

  it("stores only a hash of the code, never the code itself", async () => {
    await auth.requestCode("kavya@example.com");
    const pending = await store.getPendingCode("kavya@example.com");

    expect(pending?.codeHash).toHaveLength(64);
    expect(pending?.codeHash).not.toContain(lastCode());
  });

  it("keys sessions by a hash, so the raw token is not stored", async () => {
    await auth.requestCode("kavya@example.com");
    const { token } = await auth.verifyCode("kavya@example.com", lastCode());

    expect(await store.getSession(token)).toBeNull();
    expect(await auth.resolveToken(token)).not.toBeNull();
  });

  describe("roles", () => {
    function serviceFor(organizerEmails: string[]): AuthService {
      return new AuthService(store, {
        pepper: "test-pepper",
        organizerEmails,
        now: () => clock,
        sendCode: (email, code) => {
          sent.push({ email, code });
        },
      });
    }

    async function signIn(service: AuthService, email: string) {
      await service.requestCode(email);
      return service.verifyCode(email, lastCode());
    }

    it("signs everyone up as an attendee by default", async () => {
      const { user } = await signIn(auth, "fan@example.com");

      expect(user.role).toBe("attendee");
    });

    it("signs up a listed address as an organizer", async () => {
      const service = serviceFor(["Promoter@Example.com"]);
      const { user } = await signIn(service, "promoter@example.com");

      expect(user.role).toBe("organizer");
    });

    it("promotes an existing attendee once they are listed", async () => {
      const before = await signIn(auth, "promoter@example.com");
      expect(before.user.role).toBe("attendee");

      clock += 60_000;
      const after = await signIn(
        serviceFor(["promoter@example.com"]),
        "promoter@example.com"
      );

      expect(after.user.role).toBe("organizer");
      expect(after.user.id).toBe(before.user.id);
    });

    it("demotes an organizer once they are taken off the list", async () => {
      await signIn(serviceFor(["promoter@example.com"]), "promoter@example.com");

      clock += 60_000;
      const { user } = await signIn(auth, "promoter@example.com");

      expect(user.role).toBe("attendee");
    });

    it("signs up a listed address as door staff", async () => {
      const service = new AuthService(store, {
        pepper: "test-pepper",
        staffEmails: ["door@example.com"],
        now: () => clock,
        sendCode: (email, code) => {
          sent.push({ email, code });
        },
      });

      const { user } = await signIn(service, "door@example.com");

      expect(user.role).toBe("staff");
    });

    it("puts door staff ahead of the organizer list", async () => {
      const service = new AuthService(store, {
        pepper: "test-pepper",
        organizerEmails: ["door@example.com"],
        staffEmails: ["door@example.com"],
        now: () => clock,
        sendCode: (email, code) => {
          sent.push({ email, code });
        },
      });

      const { user } = await signIn(service, "door@example.com");

      expect(user.role).toBe("staff");
    });

    it("takes the badge back when an address leaves the staff list", async () => {
      const service = new AuthService(store, {
        pepper: "test-pepper",
        staffEmails: ["door@example.com"],
        now: () => clock,
        sendCode: (email, code) => {
          sent.push({ email, code });
        },
      });
      await signIn(service, "door@example.com");

      clock += 60_000;
      const { user } = await signIn(auth, "door@example.com");

      expect(user.role).toBe("attendee");
    });
  });
});
