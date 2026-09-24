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

  it("registers a customer and sets an httpOnly cookie", async () => {
    const response = await register({
      email: "kavya@example.com",
      password: TEST_PASSWORD,
      role: "customer",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe("kavya@example.com");
    expect(response.json().user.role).toBe("customer");

    const cookie = response.cookies.find((entry) => entry.name === "session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe("lax");
  });

  it("registers a seller under the seller role", async () => {
    const response = await register({
      email: "seller@example.com",
      password: TEST_PASSWORD,
      role: "seller",
      displayName: "Row J Tickets",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.role).toBe("seller");
    expect(response.json().user.displayName).toBe("Row J Tickets");
  });

  it("refuses to register anyone as an admin", async () => {
    const response = await register({
      email: "sneaky@example.com",
      password: TEST_PASSWORD,
      role: "admin",
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const response = await register({
      email: "nope",
      password: TEST_PASSWORD,
      role: "customer",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_email");
  });

  it("rejects a password that is too short", async () => {
    const response = await register({
      email: "kavya@example.com",
      password: "short",
      role: "customer",
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
      role: "customer",
    });

    const response = await register({
      email: "kavya@example.com",
      password: TEST_PASSWORD,
      role: "seller",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("email_taken");
  });

  it("signs in with the right password", async () => {
    await signUp(app, "kavya@example.com", "customer");

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
    await signUp(app, "kavya@example.com", "customer");

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

  it("turns a customer away from the seller entrance", async () => {
    await signUp(app, "kavya@example.com", "customer");

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "kavya@example.com",
        password: TEST_PASSWORD,
        role: "seller",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("lets the admin from the admin file sign in", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "admin@example.com",
        password: "admin-password",
        role: "admin",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe("admin");
  });

  it("returns 401 from /me when not signed in", async () => {
    const response = await app.inject({ method: "GET", url: "/me" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the signed in user from /me", async () => {
    const session = await signUp(app, "kavya@example.com", "customer");

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
    const session = await signUp(app, "kavya@example.com", "customer");

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
    const first = await signUp(app, "kavya@example.com", "customer");
    const second = await signUp(app, "diya@example.com", "customer");

    expect(first).not.toBe(second);

    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: second },
    });
    expect(me.json().user.email).toBe("diya@example.com");
  });

  it("gives the same person a fresh session each time they sign in", async () => {
    const first = await signUp(app, "kavya@example.com", "customer");
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
