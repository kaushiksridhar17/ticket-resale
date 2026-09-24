import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { TEST_PASSWORD } from "../testAuth.js";

describe("session cookie flags", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  async function cookieFor(env: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    const { app } = await buildServer({
      logPath: null,
      authPepper: "p",
      admin: null,
    });
    await app.ready();
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "a@b.co", password: TEST_PASSWORD, role: "customer" },
    });
    await app.close();
    return registered.cookies.find((c) => c.name === "session")!;
  }

  it("is not secure when running plainly", async () => {
    expect((await cookieFor({ NODE_ENV: "test", SECURE_COOKIES: undefined })).secure).toBeFalsy();
  });

  it("is secure in production", async () => {
    expect((await cookieFor({ NODE_ENV: "production", SECURE_COOKIES: undefined })).secure).toBe(true);
  });

  it("can be turned off for plain http", async () => {
    expect((await cookieFor({ NODE_ENV: "production", SECURE_COOKIES: "false" })).secure).toBeFalsy();
  });
});
