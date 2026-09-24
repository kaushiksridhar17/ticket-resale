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

  function register(email: string, password = "a-good-password", role: "customer" | "seller" = "customer") {
    return auth.register({ email, password, role });
  }

  it("signs somebody up and hands back a session", async () => {
    const { user, token } = await register("rosie@example.com");

    expect(user.email).toBe("rosie@example.com");
    expect(user.role).toBe("customer");
    expect(user.status).toBe("active");
    expect(await auth.resolveToken(token)).toMatchObject({ id: user.id });
  });

  it("keeps the role chosen at sign-up", async () => {
    const { user } = await register("seller@example.com", "a-good-password", "seller");

    expect(user.role).toBe("seller");
    expect((await auth.logIn("seller@example.com", "a-good-password")).user.role).toBe(
      "seller"
    );
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

  it("refuses to hand out an admin account at sign-up", async () => {
    await expect(
      auth.register({
        email: "sneaky@example.com",
        password: "a-good-password",
        role: "admin" as never,
      })
    ).rejects.toMatchObject({ code: "invalid_role" });
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

  it("refuses a customer trying the seller entrance", async () => {
    await register("rosie@example.com");

    await expect(
      auth.logIn("rosie@example.com", "a-good-password", "seller")
    ).rejects.toMatchObject({ code: "wrong_credentials" });
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

  it("lets the admin in through the admin entrance", async () => {
    await auth.ensureAdmin("boss@example.com", "a-good-password", "Boss");

    const { user } = await auth.logIn("boss@example.com", "a-good-password", "admin");
    expect(user.role).toBe("admin");
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
