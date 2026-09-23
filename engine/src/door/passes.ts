import { createHmac, timingSafeEqual } from "node:crypto";

export const SLOT_MS = 30_000;
const SIGNATURE_LENGTH = 22;

export interface Pass {
  ticketId: string;
  rotation: number;
  slot: number;
}

export interface IssuedPass {
  token: string;
  expiresAt: number;
  rotation: number;
}

export type PassFailure = "malformed" | "expired" | "forged";

export class PassIssuer {
  private readonly now: () => number;

  constructor(
    private readonly key: string,
    now: () => number = () => Date.now()
  ) {
    if (key.length === 0) {
      throw new Error("A door key is required");
    }
    this.now = now;
  }

  issue(ticketId: string, rotation: number): IssuedPass {
    const slot = Math.floor(this.now() / SLOT_MS);
    return {
      token: this.sign({ ticketId, rotation, slot }),
      expiresAt: (slot + 1) * SLOT_MS,
      rotation,
    };
  }

  verify(token: string): Pass | PassFailure {
    const parts = token.split(".");
    if (parts.length !== 4) {
      return "malformed";
    }

    const [ticketId, rotationText, slotText, signature] = parts as [
      string,
      string,
      string,
      string,
    ];
    const rotation = Number(rotationText);
    const slot = Number(slotText);

    if (
      ticketId.length === 0 ||
      !/^\d+$/.test(rotationText) ||
      !/^\d+$/.test(slotText) ||
      !Number.isSafeInteger(rotation) ||
      !Number.isSafeInteger(slot)
    ) {
      return "malformed";
    }

    const pass: Pass = { ticketId, rotation, slot };
    if (!this.matches(signature, this.signature(pass))) {
      return "forged";
    }

    const current = Math.floor(this.now() / SLOT_MS);
    if (slot < current - 1 || slot > current + 1) {
      return "expired";
    }

    return pass;
  }

  private sign(pass: Pass): string {
    return `${pass.ticketId}.${pass.rotation}.${pass.slot}.${this.signature(pass)}`;
  }

  private signature(pass: Pass): string {
    return createHmac("sha256", this.key)
      .update(`${pass.ticketId}:${pass.rotation}:${pass.slot}`)
      .digest("base64url")
      .slice(0, SIGNATURE_LENGTH);
  }

  private matches(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
