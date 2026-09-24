import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findAdmin, readAdminEnv, readAdminFile } from "./bootstrap.js";

describe("admin bootstrap details", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "facevalue-admin-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(contents: string): string {
    const path = join(dir, "admin.json");
    writeFileSync(path, contents);
    return path;
  }

  it("reads an admin out of a file", () => {
    const path = write(
      JSON.stringify({ email: "me@example.com", password: "long-enough", name: "Me" })
    );

    expect(readAdminFile(path)).toEqual({
      email: "me@example.com",
      password: "long-enough",
      name: "Me",
    });
  });

  it("treats a missing file as no admin at all", () => {
    expect(readAdminFile(join(dir, "nothing-here.json"))).toBeNull();
  });

  it("complains about a file that is not JSON", () => {
    const path = write("{ this is not json");

    expect(() => readAdminFile(path)).toThrow(/valid JSON/);
  });

  it("complains about a file missing the password", () => {
    const path = write(JSON.stringify({ email: "me@example.com" }));

    expect(() => readAdminFile(path)).toThrow(/email and a password/);
  });

  it("reads an admin out of the environment", () => {
    expect(
      readAdminEnv({
        ADMIN_EMAIL: "me@example.com",
        ADMIN_PASSWORD: "long-enough",
        ADMIN_NAME: "Me",
      })
    ).toEqual({
      email: "me@example.com",
      password: "long-enough",
      name: "Me",
    });
  });

  it("ignores an environment with only half the details", () => {
    expect(readAdminEnv({ ADMIN_EMAIL: "me@example.com" })).toBeNull();
    expect(readAdminEnv({ ADMIN_PASSWORD: "long-enough" })).toBeNull();
    expect(readAdminEnv({})).toBeNull();
  });

  it("prefers the file over the environment", () => {
    const path = write(
      JSON.stringify({ email: "file@example.com", password: "long-enough" })
    );

    expect(
      findAdmin(path, {
        ADMIN_EMAIL: "env@example.com",
        ADMIN_PASSWORD: "also-long-enough",
      })?.email
    ).toBe("file@example.com");
  });

  it("falls back to the environment when there is no file", () => {
    expect(
      findAdmin(join(dir, "nothing-here.json"), {
        ADMIN_EMAIL: "env@example.com",
        ADMIN_PASSWORD: "also-long-enough",
      })?.email
    ).toBe("env@example.com");
  });
});
