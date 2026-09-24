import { beforeEach, describe, expect, it } from "vitest";
import { AuthError, AuthService } from "./service.js";
import { MemoryAuthStore } from "./memoryStore.js";

describe("AuthService", () => {
  let store: MemoryAuthStore;
  let clock: number;
  let auth: AuthService;

  beforeEach(() => {
    store = new MemoryAuthStore();
    clock = 1_700_000_000_000;
    auth = new AuthService(store, { pepper: "test-pepper", now: () => clock });
  });

  function register(
    email: string,
    password = "a-good-password",
    choices: { buys?: boolean; sells?: boolean } = {}
  ) {
    return auth.register({
      email,
      password,
      buys: choices.buys ?? true,
      sells: choices.sells ?? false,
    });
  }

  it("signs somebody up and hands back a session", async () => {
    const { user, token } = await register("rosie@example.com");

    expect(user.email).toBe("rosie@example.com");
    expect(user.role).toBe("member");
    expect(user.status).toBe("active");
    expect(user.buys).toBe(true);
    expect(user.sells).toBe(false);
    expect(user.theme).toBe("system");
    expect(await auth.resolveToken(token)).toMatchObject({ id: user.id });
  });

  it("keeps what was chosen at sign-up", async () => {
    const { user } = await register("both@example.com", "a-good-password", {
      buys: true,
      sells: true,
    });

    expect(user.buys).toBe(true);
    expect(user.sells).toBe(true);

    const { user: again } = await auth.logIn("both@example.com", "a-good-password");
    expect(again.buys).toBe(true);
    expect(again.sells).toBe(true);
  });

  it("refuses a sign-up that does neither", async () => {
    await expect(
      auth.register({
        email: "nobody@example.com",
        password: "a-good-password",
        buys: false,
        sells: false,
      })
    ).rejects.toMatchObject({ code: "nothing_chosen" });
  });

  it("treats addresses case insensitively", async () => {
    await register("Rosie@Example.com");

    const { user } = await auth.logIn("rosie@example.com", "a-good-password");
    expect(user.email).toBe("rosie@example.com");
  });

  it("refuses a second account on the same address", async () => {
    await register("rosie@example.com");

    await expect(register("rosie@example.com")).rejects.toMatchObject({
      code: "email_taken",
    });
  });

  it("refuses something that is not an email", async () => {
    await expect(register("not-an-email")).rejects.toMatchObject({
      code: "invalid_email",
    });
  });

  it("refuses a password anyone could guess at", async () => {
    await expect(register("rosie@example.com", "short")).rejects.toMatchObject({
      code: "weak_password",
    });
  });

  it("never hands out an admin account at sign-up", async () => {
    const { user } = await register("sneaky@example.com");

    expect(user.role).toBe("member");
    expect(await store.countByRole("admin")).toBe(0);
  });

  it("turns away the wrong password", async () => {
    await register("rosie@example.com");

    await expect(
      auth.logIn("rosie@example.com", "not-the-password")
    ).rejects.toMatchObject({ code: "wrong_credentials" });
  });

  it("says the same thing whether the account exists or not", async () => {
    await register("rosie@example.com");

    const wrongPassword = await auth
      .logIn("rosie@example.com", "nope-nope-nope")
      .catch((error: AuthError) => error.message);
    const noSuchAccount = await auth
      .logIn("ghost@example.com", "nope-nope-nope")
      .catch((error: AuthError) => error.message);

    expect(wrongPassword).toBe(noSuchAccount);
  });

  it("signs somebody in without being told what they are", async () => {
    await register("rosie@example.com");

    const { user } = await auth.logIn("rosie@example.com", "a-good-password");

    expect(user.role).toBe("member");
    expect(user.buys).toBe(true);
  });

  it("turns away a suspended account and drops its sessions", async () => {
    const { user, token } = await register("rosie@example.com");

    await auth.setStatus(user.id, "suspended");

    expect(await auth.resolveToken(token)).toBeNull();
    await expect(
      auth.logIn("rosie@example.com", "a-good-password")
    ).rejects.toMatchObject({ code: "suspended" });
  });

  it("forgets a session once it has expired", async () => {
    const { token } = await register("rosie@example.com");

    clock += 31 * 24 * 60 * 60 * 1000;

    expect(await auth.resolveToken(token)).toBeNull();
  });

  it("forgets a session on the way out", async () => {
    const { token } = await register("rosie@example.com");

    await auth.logOut(token);

    expect(await auth.resolveToken(token)).toBeNull();
  });

  it("ignores a token nobody issued", async () => {
    expect(await auth.resolveToken("made-up")).toBeNull();
    expect(await auth.resolveToken(undefined)).toBeNull();
  });

  it("creates the admin once and never again", async () => {
    const first = await auth.ensureAdmin("boss@example.com", "a-good-password", "Boss");
    const second = await auth.ensureAdmin("other@example.com", "a-good-password", null);

    expect(first?.role).toBe("admin");
    expect(second).toBeNull();
    expect(await store.countByRole("admin")).toBe(1);
  });

  it("lets the admin in through the same door as everybody else", async () => {
    await auth.ensureAdmin("boss@example.com", "a-good-password", "Boss");

    const { user } = await auth.logIn("boss@example.com", "a-good-password");
    expect(user.role).toBe("admin");
  });

  it("turns buying or selling on and off", async () => {
    const { user } = await register("rosie@example.com");

    const selling = await auth.updateSettings(user.id, { sells: true });
    expect(selling.sells).toBe(true);
    expect(selling.buys).toBe(true);

    const sellingOnly = await auth.updateSettings(user.id, { buys: false });
    expect(sellingOnly.buys).toBe(false);
    expect(sellingOnly.sells).toBe(true);
  });

  it("refuses to leave an account doing neither", async () => {
    const { user } = await register("rosie@example.com");

    await expect(
      auth.updateSettings(user.id, { buys: false })
    ).rejects.toMatchObject({ code: "nothing_chosen" });
  });

  it("remembers the theme against the account", async () => {
    const { user } = await register("rosie@example.com");

    await auth.updateSettings(user.id, { theme: "dark" });

    const { user: nextTime } = await auth.logIn(
      "rosie@example.com",
      "a-good-password"
    );
    expect(nextTime.theme).toBe("dark");
  });

  it("turns away a theme it does not have", async () => {
    const { user } = await register("rosie@example.com");

    await expect(
      auth.updateSettings(user.id, { theme: "neon" as never })
    ).rejects.toMatchObject({ code: "invalid_theme" });
  });

  it("changes a password once the old one checks out", async () => {
    const { user } = await register("rosie@example.com");

    await auth.changePassword(user.id, "a-good-password", "a-better-password");

    await expect(
      auth.logIn("rosie@example.com", "a-good-password")
    ).rejects.toMatchObject({ code: "wrong_credentials" });
    await expect(
      auth.logIn("rosie@example.com", "a-better-password")
    ).resolves.toMatchObject({ user: { id: user.id } });
  });

  it("will not change a password without the old one", async () => {
    const { user } = await register("rosie@example.com");

    await expect(
      auth.changePassword(user.id, "not-the-password", "a-better-password")
    ).rejects.toMatchObject({ code: "wrong_credentials" });
  });

  it("will not change a password to a weak one", async () => {
    const { user } = await register("rosie@example.com");

    await expect(
      auth.changePassword(user.id, "a-good-password", "short")
    ).rejects.toMatchObject({ code: "weak_password" });
  });

  it("drops other sessions when the password changes", async () => {
    const { user, token } = await register("rosie@example.com");
    const elsewhere = (await auth.logIn("rosie@example.com", "a-good-password"))
      .token;

    const fresh = await auth.changePassword(
      user.id,
      "a-good-password",
      "a-better-password"
    );

    expect(await auth.resolveToken(token)).toBeNull();
    expect(await auth.resolveToken(elsewhere)).toBeNull();
    expect(await auth.resolveToken(fresh)).toMatchObject({ id: user.id });
  });

  it("keys sessions by a hash, so the raw token is not stored", async () => {
    const { token } = await register("rosie@example.com");

    expect(await store.getSession(token)).toBeNull();
    expect(await auth.resolveToken(token)).not.toBeNull();
  });

  it("never stores the password in the clear", async () => {
    const { user } = await register("rosie@example.com", "a-good-password");
    const stored = await store.getPasswordHash(user.id);

    expect(stored).not.toContain("a-good-password");
    expect(stored?.startsWith("scrypt$")).toBe(true);
  });
});
