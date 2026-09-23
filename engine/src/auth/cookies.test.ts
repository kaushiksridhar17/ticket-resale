import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

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
    const codes: string[] = [];
    const { app } = await buildServer({
      logPath: null,
      authPepper: "p",
      sendCode: (_e, c) => void codes.push(c),
    });
    await app.ready();
    await app.inject({ method: "POST", url: "/auth/request", payload: { email: "a@b.co" } });
    const verified = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { email: "a@b.co", code: codes[0] },
    });
    await app.close();
    return verified.cookies.find((c) => c.name === "session")!;
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
