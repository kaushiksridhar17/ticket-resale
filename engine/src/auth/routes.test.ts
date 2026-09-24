import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { TEST_PASSWORD, signIn, signUp } from "../testAuth.js";
import type { FastifyInstance } from "fastify";

describe("auth routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      admin: {
        email: "admin@example.com",
        password: "admin-password",
        name: "Admin",
      },
    });
    app = built.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function register(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/auth/register",
      payload,
    });
  }

  it("registers a buyer and sets an httpOnly cookie", async () => {
    const response = await register({
      email: "kavya@example.com",
      password: TEST_PASSWORD,
      buys: true,
      sells: false,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe("kavya@example.com");
    expect(response.json().user.role).toBe("member");
    expect(response.json().user.buys).toBe(true);
    expect(response.json().user.sells).toBe(false);

    const cookie = response.cookies.find((entry) => entry.name === "session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe("lax");
  });

  it("registers somebody who does both", async () => {
    const response = await register({
      email: "both@example.com",
      password: TEST_PASSWORD,
      buys: true,
      sells: true,
      displayName: "Row J Tickets",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.buys).toBe(true);
    expect(response.json().user.sells).toBe(true);
    expect(response.json().user.displayName).toBe("Row J Tickets");
  });

  it("refuses a registration that does neither", async () => {
    const response = await register({
      email: "nobody@example.com",
      password: TEST_PASSWORD,
      buys: false,
      sells: false,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("nothing_chosen");
  });

  it("ignores a role sent by hand", async () => {
    const response = await register({
      email: "sneaky@example.com",
      password: TEST_PASSWORD,
      buys: true,
      sells: false,
      role: "admin",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.role).toBe("member");
  });

  it("rejects a malformed email", async () => {
    const response = await register({
      email: "nope",
      password: TEST_PASSWORD,
      buys: true,
      sells: false,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_email");
  });

  it("rejects a password that is too short", async () => {
    const response = await register({
      email: "kavya@example.com",
      password: "short",
      buys: true,
      sells: false,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("weak_password");
  });

  it("rejects a registration with nothing in it", async () => {
    const response = await register({});

    expect(response.statusCode).toBe(400);
  });

  it("returns 409 when the email is already taken", async () => {
    await register({
      email: "kavya@example.com",
      password: TEST_PASSWORD,
      buys: true,
      sells: false,
    });

    const response = await register({
      email: "kavya@example.com",
      password: TEST_PASSWORD,
      buys: false,
      sells: true,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("email_taken");
  });

  it("signs in with the right password", async () => {
    await signUp(app, "kavya@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "kavya@example.com", password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("kavya@example.com");
    expect(response.cookies.some((entry) => entry.name === "session")).toBe(true);
  });

  it("returns 401 for a wrong password", async () => {
    await signUp(app, "kavya@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "kavya@example.com", password: "not-the-password" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("wrong_credentials");
  });

  it("returns 401 for an account that does not exist", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.com", password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("wrong_credentials");
  });

  it("reports back what the account does rather than being told it", async () => {
    await signUp(app, "seller@example.com", { buys: false, sells: true });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "seller@example.com", password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.buys).toBe(false);
    expect(response.json().user.sells).toBe(true);
  });

  it("lets the admin from the admin file in through the same door", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.com", password: "admin-password" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe("admin");
  });

  it("returns 401 from /me when not signed in", async () => {
    const response = await app.inject({ method: "GET", url: "/me" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the signed in user from /me", async () => {
    const session = await signUp(app, "kavya@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("kavya@example.com");
    expect(response.json().user.status).toBe("active");
  });

  it("ignores a made up session cookie", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: "not-a-real-token" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("stops accepting the session after logout", async () => {
    const session = await signUp(app, "kavya@example.com");

    const loggedOut = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session },
    });
    expect(loggedOut.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session },
    });
    expect(after.statusCode).toBe(401);
  });

  it("gives two people separate sessions", async () => {
    const first = await signUp(app, "kavya@example.com");
    const second = await signUp(app, "diya@example.com");

    expect(first).not.toBe(second);

    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: second },
    });
    expect(me.json().user.email).toBe("diya@example.com");
  });

  it("gives the same person a fresh session each time they sign in", async () => {
    const first = await signUp(app, "kavya@example.com");
    const second = await signIn(app, "kavya@example.com");

    expect(first).not.toBe(second);

    for (const session of [first, second]) {
      const me = await app.inject({
        method: "GET",
        url: "/me",
        cookies: { session },
      });
      expect(me.statusCode).toBe(200);
    }
  });
});

describe("settings routes", () => {
  let app: FastifyInstance;
  let session: string;

  beforeEach(async () => {
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      admin: null,
    });
    app = built.app;
    await app.ready();
    session = await signUp(app, "kavya@example.com");
  });

  afterEach(async () => {
    await app.close();
  });

  function settings(payload: Record<string, unknown>, cookie = session) {
    return app.inject({
      method: "PATCH",
      url: "/me/settings",
      cookies: { session: cookie },
      payload,
    });
  }

  it("turns selling on and hands the account straight back", async () => {
    const response = await settings({ sells: true });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.sells).toBe(true);
    expect(response.json().user.buys).toBe(true);
  });

  it("keeps the change for next time", async () => {
    await settings({ theme: "dark", sells: true });

    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session },
    });
    expect(me.json().user.theme).toBe("dark");
    expect(me.json().user.sells).toBe(true);
  });

  it("refuses to leave an account doing neither", async () => {
    const response = await settings({ buys: false, sells: false });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("nothing_chosen");
  });

  it("refuses a theme it does not have", async () => {
    expect((await settings({ theme: "neon" })).statusCode).toBe(400);
  });

  it("refuses an empty change", async () => {
    expect((await settings({})).statusCode).toBe(400);
  });

  it("refuses to change settings without a session", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/me/settings",
      payload: { theme: "dark" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("changes the password and keeps this browser signed in", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/me/password",
      cookies: { session },
      payload: {
        currentPassword: TEST_PASSWORD,
        newPassword: "a-brand-new-password",
      },
    });

    expect(response.statusCode).toBe(204);

    const fresh = response.cookies.find((entry) => entry.name === "session")!;
    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: fresh.value },
    });
    expect(me.statusCode).toBe(200);

    const old = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session },
    });
    expect(old.statusCode).toBe(401);
  });

  it("refuses to change the password without the old one", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/me/password",
      cookies: { session },
      payload: {
        currentPassword: "not-the-password",
        newPassword: "a-brand-new-password",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("refuses to change the password to a weak one", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/me/password",
      cookies: { session },
      payload: { currentPassword: TEST_PASSWORD, newPassword: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("weak_password");
  });
});
