import { describe, expect, it } from "vitest";
import {
  MINIMUM_LENGTH,
  WeakPassword,
  hashPassword,
  verifyPassword,
} from "./passwords.js";

describe("passwords", () => {
  it("accepts the password it hashed", async () => {
    const stored = await hashPassword("correct horse battery");

    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
  });

  it("rejects a password that is not the one", async () => {
    const stored = await hashPassword("correct horse battery");

    expect(await verifyPassword("correct horse batterz", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword("hunter2hunter2");

    expect(stored).not.toContain("hunter2");
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("gives two people with the same password different hashes", async () => {
    const first = await hashPassword("the same password");
    const second = await hashPassword("the same password");

    expect(first).not.toBe(second);
    expect(await verifyPassword("the same password", first)).toBe(true);
    expect(await verifyPassword("the same password", second)).toBe(true);
  });

  it("treats the same characters written differently as the same password", async () => {
    const stored = await hashPassword("passépassword");

    expect(await verifyPassword("passépassword", stored)).toBe(true);
  });

  it("turns away passwords that are too short", async () => {
    await expect(hashPassword("a".repeat(MINIMUM_LENGTH - 1))).rejects.toThrow(
      WeakPassword
    );
  });

  it("turns away passwords that are absurdly long", async () => {
    await expect(hashPassword("a".repeat(1000))).rejects.toThrow(WeakPassword);
  });

  it("still accepts a password hashed at a different cost", async () => {
    const previous = process.env.PASSWORD_COST;
    process.env.PASSWORD_COST = "512";
    const cheap = await hashPassword("correct horse battery");
    process.env.PASSWORD_COST = "2048";
    const dearer = await hashPassword("correct horse battery");
    process.env.PASSWORD_COST = previous;

    expect(cheap).toContain("scrypt$512$");
    expect(dearer).toContain("scrypt$2048$");
    expect(await verifyPassword("correct horse battery", cheap)).toBe(true);
    expect(await verifyPassword("correct horse battery", dearer)).toBe(true);
  });

  it("refuses anything that is not one of our hashes", async () => {
    expect(await verifyPassword("whatever", "")).toBe(false);
    expect(await verifyPassword("whatever", "plaintext")).toBe(false);
    expect(await verifyPassword("whatever", "bcrypt$1$2$3$4$5")).toBe(false);
    expect(await verifyPassword("whatever", "scrypt$x$8$1$AAAA$BBBB")).toBe(false);
  });
});
