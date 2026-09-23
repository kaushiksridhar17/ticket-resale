import { beforeEach, describe, expect, it } from "vitest";
import { PassIssuer, SLOT_MS } from "./passes.js";

describe("door passes", () => {
  let clock: number;
  let issuer: PassIssuer;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    issuer = new PassIssuer("door-key", () => clock);
  });

  it("refuses to start without a key", () => {
    expect(() => new PassIssuer("")).toThrow();
  });

  it("accepts a pass it just issued", () => {
    const { token } = issuer.issue("tkt_41", 3);

    expect(issuer.verify(token)).toEqual({
      ticketId: "tkt_41",
      rotation: 3,
      slot: Math.floor(clock / SLOT_MS),
    });
  });

  it("says when the pass stops being valid", () => {
    const { expiresAt } = issuer.issue("tkt_41", 3);

    expect(expiresAt).toBeGreaterThan(clock);
    expect(expiresAt - clock).toBeLessThanOrEqual(SLOT_MS);
  });

  it("issues a different pass in the next half minute", () => {
    const first = issuer.issue("tkt_41", 3).token;
    clock += SLOT_MS;
    const second = issuer.issue("tkt_41", 3).token;

    expect(second).not.toBe(first);
  });

  it("still accepts the pass from the half minute just gone", () => {
    const { token } = issuer.issue("tkt_41", 3);
    clock += SLOT_MS;

    expect(issuer.verify(token)).toMatchObject({ ticketId: "tkt_41" });
  });

  it("accepts a pass from a door clock that runs slightly fast", () => {
    const { token } = issuer.issue("tkt_41", 3);
    clock -= SLOT_MS;

    expect(issuer.verify(token)).toMatchObject({ ticketId: "tkt_41" });
  });

  it("refuses a screenshot taken a couple of minutes ago", () => {
    const { token } = issuer.issue("tkt_41", 3);
    clock += 4 * SLOT_MS;

    expect(issuer.verify(token)).toBe("expired");
  });

  it("refuses a pass signed with another key", () => {
    const { token } = new PassIssuer("other-key", () => clock).issue("tkt_41", 3);

    expect(issuer.verify(token)).toBe("forged");
  });

  it("refuses a pass whose ticket has been altered", () => {
    const { token } = issuer.issue("tkt_41", 3);
    const parts = token.split(".");

    expect(issuer.verify(`tkt_42.${parts[1]}.${parts[2]}.${parts[3]}`)).toBe(
      "forged"
    );
  });

  it("refuses a pass whose rotation has been wound back", () => {
    const { token } = issuer.issue("tkt_41", 3);
    const parts = token.split(".");

    expect(issuer.verify(`${parts[0]}.2.${parts[2]}.${parts[3]}`)).toBe("forged");
  });

  it("refuses a pass whose slot has been moved forward", () => {
    const { token } = issuer.issue("tkt_41", 3);
    const parts = token.split(".");
    const later = Number(parts[2]) + 1;

    expect(issuer.verify(`${parts[0]}.${parts[1]}.${later}.${parts[3]}`)).toBe(
      "forged"
    );
  });

  it("refuses anything that is not a pass", () => {
    expect(issuer.verify("")).toBe("malformed");
    expect(issuer.verify("tkt_41")).toBe("malformed");
    expect(issuer.verify("tkt_41.3.abc.xxxx")).toBe("malformed");
    expect(issuer.verify("tkt_41.3.100.xxxx.extra")).toBe("malformed");
    expect(issuer.verify(".3.100.xxxx")).toBe("malformed");
  });

  it("gives every ticket a different pass in the same half minute", () => {
    const first = issuer.issue("tkt_41", 0).token;
    const second = issuer.issue("tkt_42", 0).token;

    expect(first.split(".")[3]).not.toBe(second.split(".")[3]);
  });

  it("gives a different pass once a ticket has been passed on", () => {
    const before = issuer.issue("tkt_41", 3).token;
    const after = issuer.issue("tkt_41", 4).token;

    expect(after).not.toBe(before);
    expect(issuer.verify(after)).toMatchObject({ rotation: 4 });
  });
});
