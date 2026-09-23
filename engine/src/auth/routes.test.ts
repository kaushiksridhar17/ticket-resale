import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import type { FastifyInstance } from "fastify";

describe("auth routes", () => {
  let app: FastifyInstance;
  let codes: { email: string; code: string }[];

  beforeEach(async () => {
    codes = [];
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      sendCode: (email, code) => {
        codes.push({ email, code });
      },
    });
    app = built.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function lastCode(): string {
    return codes[codes.length - 1]!.code;
  }

  async function requestCode(email: string) {
    return app.inject({
      method: "POST",
      url: "/auth/request",
      payload: { email },
    });
  }

  async function signIn(email: string): Promise<string> {
    await requestCode(email);
    const response = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { email, code: lastCode() },
    });
    const cookie = response.cookies.find((entry) => entry.name === "session");
    return cookie!.value;
  }

  it("sends a code and does not reveal it in the response", async () => {
    const response = await requestCode("kavya@example.com");

    expect(response.statusCode).toBe(202);
    expect(codes).toHaveLength(1);
    expect(response.body).not.toContain(lastCode());
  });

  it("rejects a malformed email", async () => {
    const response = await requestCode("nope");

    expect(response.statusCode).toBe(400);
    expect(codes).toHaveLength(0);
  });

  it("rejects a request with no email at all", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/request",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 429 when codes are requested too quickly", async () => {
    await requestCode("kavya@example.com");
    const response = await requestCode("kavya@example.com");

    expect(response.statusCode).toBe(429);
  });

  it("signs in with a correct code and sets an httpOnly cookie", async () => {
    await requestCode("kavya@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { email: "kavya@example.com", code: lastCode() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("kavya@example.com");
    expect(response.json().user.role).toBe("attendee");

    const cookie = response.cookies.find((entry) => entry.name === "session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe("lax");
  });

  it("rejects a wrong code", async () => {
    await requestCode("kavya@example.com");
    const wrong = lastCode() === "000000" ? "111111" : "000000";

    const response = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { email: "kavya@example.com", code: wrong },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_code");
  });

  it("rejects a code of the wrong shape before reaching the service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { email: "kavya@example.com", code: "12" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 401 from /me when not signed in", async () => {
    const response = await app.inject({ method: "GET", url: "/me" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the signed in user from /me", async () => {
    const session = await signIn("kavya@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("kavya@example.com");
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
    const session = await signIn("kavya@example.com");

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
    const first = await signIn("kavya@example.com");
    const second = await signIn("diya@example.com");

    expect(first).not.toBe(second);

    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: second },
    });
    expect(me.json().user.email).toBe("diya@example.com");
  });
});